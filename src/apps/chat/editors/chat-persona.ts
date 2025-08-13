import { AixChatGenerateContent_DMessage, aixChatGenerateContent_DMessage_FromConversation } from '~/modules/aix/client/aix.client';
import { apiAsyncNode } from '~/common/util/trpc.client';
import { create_FunctionCallResponse_ContentFragment, isContentFragment } from '~/common/stores/chat/chat.fragments';
import type { DMessageToolInvocationPart } from '~/common/stores/chat/chat.fragments';
import { parseMCPToolName } from '~/modules/mcp';
import { autoChatFollowUps } from '~/modules/aifn/auto-chat-follow-ups/autoChatFollowUps';
import { autoConversationTitle } from '~/modules/aifn/autotitle/autoTitle';

import { DConversationId, splitSystemMessageFromHistory } from '~/common/stores/chat/chat.conversation';
import type { DLLMId } from '~/common/stores/llms/llms.types';
import { AudioGenerator } from '~/common/util/audio/AudioGenerator';
import { ConversationsManager } from '~/common/chat-overlay/ConversationsManager';
import { DMessage, MESSAGE_FLAG_NOTIFY_COMPLETE, messageWasInterruptedAtStart } from '~/common/stores/chat/chat.message';
import { getUXLabsHighPerformance } from '~/common/stores/store-ux-labs';

import { PersonaChatMessageSpeak } from './persona/PersonaChatMessageSpeak';
import { getChatAutoAI, getIsNotificationEnabledForModel } from '../store-app-chat';
import { getInstantAppChatPanesCount } from '../components/panes/store-panes-manager';

// configuration
export const CHATGENERATE_RESPONSE_PLACEHOLDER = '...'; // 💫 ..., 🖊️ ...

export interface PersonaProcessorInterface {
  handleMessage(accumulatedMessage: AixChatGenerateContent_DMessage, messageComplete: boolean): void;
}

/**
 * Agentic chat loop with MCP tool execution. Continues calling the model until no further tool invocations are emitted or maxLoops reached.
 */
export async function runAgenticOnConversationHead(assistantLlmId: DLLMId, conversationId: DConversationId): Promise<boolean> {
  const cHandler = ConversationsManager.getHandler(conversationId);

  const _history = cHandler.historyViewHeadOrThrow('runAgenticOnConversationHead') as Readonly<DMessage[]>;
  if (_history.length === 0) return false;

  // split pre dynamic-personas
  let { chatSystemInstruction } = splitSystemMessageFromHistory(_history);

  // assistant response placeholder
  const isNotifyEnabled = getIsNotificationEnabledForModel(assistantLlmId);
  const { assistantMessageId } = cHandler.messageAppendAssistantPlaceholder(CHATGENERATE_RESPONSE_PLACEHOLDER, {
    purposeId: chatSystemInstruction?.purposeId,
    generator: { mgt: 'named', name: assistantLlmId },
    ...(isNotifyEnabled ? { userFlags: [MESSAGE_FLAG_NOTIFY_COMPLETE] } : {}),
  });

  const parallelViewCount = getUXLabsHighPerformance() ? 0 : getInstantAppChatPanesCount();
  const abortController = new AbortController();
  cHandler.setAbortController(abortController, 'chat-persona-agentic');

  const maxLoops = 40;
  for (let loop = 0; loop < maxLoops; loop++) {
    // re-read current history each loop (includes prior assistant/tool messages)
    const { chatHistory } = splitSystemMessageFromHistory(cHandler.historyViewHeadOrThrow('agentic-loop'));

    // stream assistant update into the same assistant message
    const messageStatus = await aixChatGenerateContent_DMessage_FromConversation(
      assistantLlmId,
      chatSystemInstruction,
      chatHistory,
      'conversation',
      conversationId,
      { abortSignal: abortController.signal, throttleParallelThreads: parallelViewCount },
      (messageOverwrite: AixChatGenerateContent_DMessage, messageComplete: boolean) => {
        const deepCopy = structuredClone(messageOverwrite);
        if (!messageComplete && deepCopy.pendingIncomplete && deepCopy.fragments?.length === 0) delete (deepCopy as any).fragments;
        cHandler.messageEdit(assistantMessageId, deepCopy, messageComplete, false);
      },
    );

    // If errored, finalize and stop
    if (messageStatus.outcome === 'errored') {
      const lastDeepCopy = structuredClone(messageStatus.lastDMessage);
      cHandler.messageEdit(assistantMessageId, lastDeepCopy, true, false);
      return false;
    }

    // Collect tool invocations from the last assistant message
    const lastD = messageStatus.lastDMessage;
    const invocations: { id: string; name: string; args: string }[] = lastD.fragments
      .filter(isContentFragment)
      .map((f) => f.part)
      .filter((part): part is DMessageToolInvocationPart => part.pt === 'tool_invocation' && part.invocation.type === 'function_call')
      .map((part) => ({
        id: part.id,
        name: (part.invocation as Extract<DMessageToolInvocationPart['invocation'], { type: 'function_call' }>).name,
        args: (part.invocation as Extract<DMessageToolInvocationPart['invocation'], { type: 'function_call' }>).args || '',
      }));

    if (invocations.length === 0) {
      // no tools requested: we are done
      const lastDeepCopy = structuredClone(lastD);
      cHandler.messageEdit(assistantMessageId, lastDeepCopy, true, false);
      break;
    }

    // Execute MCP tools sequentially and append tool_response fragments to the assistant message
    const appended = structuredClone(lastD);
    for (const inv of invocations) {
      const parsed = parseMCPToolName(inv.name);
      if (!parsed) continue; // non-MCP tools not handled here
      const { serverId, toolName } = parsed;

      // parse arguments as JSON object
      let argsObject: Record<string, unknown> = {};
      if (inv.args) {
        try {
          argsObject = JSON.parse(inv.args);
        } catch {
          argsObject = { _raw: inv.args };
        }
      }

      try {
        const result = await apiAsyncNode.mcp.callTool.mutate({ serverId, name: toolName, arguments: argsObject });
        const resultString = JSON.stringify(result);
        appended.fragments.push(create_FunctionCallResponse_ContentFragment(inv.id, false, inv.name, resultString, 'server'));
      } catch (err: any) {
        const errText = (err?.message || err?.toString() || 'Unknown error') as string;
        appended.fragments.push(create_FunctionCallResponse_ContentFragment(inv.id, errText, inv.name, '', 'server'));
      }
    }

    // Update the assistant message with tool responses and continue the loop
    appended.pendingIncomplete = true;
    cHandler.messageEdit(assistantMessageId, appended, false, false);
  }

  // clear abort controller when done
  cHandler.clearAbortController('chat-persona-agentic');
  return true;
}

/**
 * The main "chat" function.
 * @returns `true` if the operation was successful, `false` otherwise.
 */
export async function runPersonaOnConversationHead(assistantLlmId: DLLMId, conversationId: DConversationId): Promise<boolean> {
  const cHandler = ConversationsManager.getHandler(conversationId);

  const _history = cHandler.historyViewHeadOrThrow('runPersonaOnConversationHead') as Readonly<DMessage[]>;
  if (_history.length === 0) return false;

  // split pre dynamic-personas
  let { chatSystemInstruction, chatHistory } = splitSystemMessageFromHistory(_history);

  // assistant response placeholder
  const isNotifyEnabled = getIsNotificationEnabledForModel(assistantLlmId);
  const { assistantMessageId } = cHandler.messageAppendAssistantPlaceholder(CHATGENERATE_RESPONSE_PLACEHOLDER, {
    purposeId: chatSystemInstruction?.purposeId,
    generator: { mgt: 'named', name: assistantLlmId },
    ...(isNotifyEnabled ? { userFlags: [MESSAGE_FLAG_NOTIFY_COMPLETE] } : {}),
  });

  const parallelViewCount = getUXLabsHighPerformance() ? 0 : getInstantAppChatPanesCount();

  // ai follow-up operations (fire/forget)
  const { autoSpeak, autoSuggestDiagrams, autoSuggestHTMLUI, autoSuggestQuestions, autoTitleChat, chatKeepLastThinkingOnly } = getChatAutoAI();

  // AutoSpeak
  const autoSpeaker: PersonaProcessorInterface | null = autoSpeak !== 'off' ? new PersonaChatMessageSpeak(autoSpeak) : null;

  // when an abort controller is set, the UI switches to the "stop" mode
  const abortController = new AbortController();
  cHandler.setAbortController(abortController, 'chat-persona');

  // stream the assistant's messages directly to the state store
  const messageStatus = await aixChatGenerateContent_DMessage_FromConversation(
    assistantLlmId,
    chatSystemInstruction,
    chatHistory,
    'conversation',
    conversationId,
    { abortSignal: abortController.signal, throttleParallelThreads: parallelViewCount },
    (messageOverwrite: AixChatGenerateContent_DMessage, messageComplete: boolean) => {
      // Note: there was an abort check here, but it removed the last packet, which contained the cause and final text.
      // if (abortController.signal.aborted)
      //   console.warn('runPersonaOnConversationHead: Aborted', { conversationId, assistantLlmId, messageOverwrite });

      // deep copy the object to avoid partial updates
      let deepCopy = structuredClone(messageOverwrite);

      // [Cosmetic Logic] if the content hasn't come yet, don't replace the fragments to still show the placeholder
      if (!messageComplete && deepCopy.pendingIncomplete && deepCopy.fragments?.length === 0) delete (deepCopy as any).fragments;

      // update the message
      cHandler.messageEdit(assistantMessageId, deepCopy, messageComplete, false);

      // if requested, speak the message
      autoSpeaker?.handleMessage(messageOverwrite, messageComplete);

      // if (messageComplete)
      //   AudioGenerator.basicAstralChimes({ volume: 0.4 }, 0, 2, 250);
    },
  );

  // final message update (needed only in case of error)
  const lastDeepCopy = structuredClone(messageStatus.lastDMessage);
  if (messageStatus.outcome === 'errored') cHandler.messageEdit(assistantMessageId, lastDeepCopy, true, false);

  // special case: if the last message was aborted and had no content, delete it
  if (messageWasInterruptedAtStart(lastDeepCopy)) {
    cHandler.messagesDelete([assistantMessageId]);
    // NOTE: ok to exit here, as the abort was already done
    return false;
  }

  // notify when complete, if set
  if (cHandler.messageHasUserFlag(assistantMessageId, MESSAGE_FLAG_NOTIFY_COMPLETE)) {
    cHandler.messageSetUserFlag(assistantMessageId, MESSAGE_FLAG_NOTIFY_COMPLETE, false, false);
    AudioGenerator.chatNotifyResponse();
  }

  // check if aborted
  const hasBeenAborted = abortController.signal.aborted;

  // clear to send, again
  // FIXME: race condition? (for sure!)
  cHandler.clearAbortController('chat-persona');

  if (autoTitleChat) {
    // fire/forget, this will only set the title if it's not already set
    void autoConversationTitle(conversationId, false);
  }

  if (!hasBeenAborted && (autoSuggestDiagrams || autoSuggestHTMLUI || autoSuggestQuestions))
    void autoChatFollowUps(conversationId, assistantMessageId, autoSuggestDiagrams, autoSuggestHTMLUI, autoSuggestQuestions);

  if (chatKeepLastThinkingOnly) cHandler.historyKeepLastThinkingOnly();

  // return true if this succeeded
  return messageStatus.outcome === 'success';
}
