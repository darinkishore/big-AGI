import { conversationTitle, DConversationId } from '~/common/stores/chat/chat.conversation';
import { MESSAGE_FLAG_STARRED, messageFragmentsReduceText, messageHasUserFlag } from '~/common/stores/chat/chat.message';
import { useChatStore } from '~/common/stores/chat/store-chats';

import { ActileItem, ActileProvider } from './ActileProvider';


export interface StarredMessageItem extends ActileItem {
  conversationId: DConversationId,
  messageId: string,
}

export function providerStarredMessage(onMessageSeelect: (item: StarredMessageItem) => void): ActileProvider<StarredMessageItem> {
  return {

    // only the literal '@' at start of chat, or ' @' at end of chat
    fastCheckTriggerText: (trailingText: string) => trailingText === '@' || trailingText.endsWith(' @'),

    // finds all the starred messages in all the conversations - this could be heavy
    fetchItems: async () => {
      const { conversations } = useChatStore.getState();

      const starredMessages: StarredMessageItem[] = [];
      conversations.forEach((conversation) => {
        conversation.messages.forEach((message) => {
          messageHasUserFlag(message, MESSAGE_FLAG_STARRED) && starredMessages.push({
            // data
            conversationId: conversation.id,
            messageId: message.id,
            // looks
            key: message.id,
            label: conversationTitle(conversation) + ' - ' + messageFragmentsReduceText(message.fragments).slice(0, 32) + '...',
            // description: message.text.slice(32, 100),
            Icon: undefined,
          } satisfies StarredMessageItem);
        });
      });

      return {
        title: 'Starred Messages',
        searchPrefix: '',
        items: starredMessages,
      };
    },

    onItemSelect: item => onMessageSeelect(item as StarredMessageItem),
  };
}