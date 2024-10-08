import * as React from 'react';

import type { SxProps } from '@mui/joy/styles/types';
import { Box, Button, IconButton, Modal, ModalClose, Option, Select, Sheet, Typography } from '@mui/joy';
import CameraEnhanceIcon from '@mui/icons-material/CameraEnhance';
import DownloadIcon from '@mui/icons-material/Download';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

import { InlineError } from '~/common/components/InlineError';
import { downloadVideoFrameAsPNG, renderVideoFrameAsPNGFile } from '~/common/util/videoUtils';
import { useCameraCapture } from '~/common/components/useCameraCapture';


const captureButtonContainerSx: SxProps = {
  display: 'flex',
  gap: 1,
  justifyContent: 'space-between',
  alignItems: 'center',
};

const captureButtonSx: SxProps = {
  minWidth: 150,
  borderRadius: '3rem',
  // boxShadow: 'md',
  boxShadow: '0 8px 12px -6px rgb(var(--joy-palette-neutral-darkChannel) / 50%)',
  py: 1.5,
};


export function CameraCaptureModal(props: {
  onCloseModal: () => void,
  onAttachImage: (file: File) => void
  // onOCR: (ocrText: string) => void }
}) {

  // state
  const [showInfo, setShowInfo] = React.useState(false);
  // const [ocrProgress/*, setOCRProgress*/] = React.useState<number | null>(null);

  // external state
  const {
    videoRef,
    cameras, cameraIdx, setCameraIdx,
    zoomControl, info, error,
    resetVideo,
  } = useCameraCapture();


  // derived state
  const { onCloseModal, onAttachImage } = props;


  const stopAndClose = React.useCallback(() => {
    resetVideo();
    onCloseModal();
  }, [onCloseModal, resetVideo]);

  /*const handleVideoOCRClicked = async () => {
    if (!videoRef.current) return;
    const renderedFrame = renderVideoFrameToCanvas(videoRef.current);

    setOCRProgress(0);
    const { recognize } = await import('tesseract.js');
    const result = await recognize(renderedFrame, undefined, {
      logger: m => {
        // noinspection SuspiciousTypeOfGuard
        if (typeof m.progress === 'number')
          setOCRProgress(m.progress);
      },
      errorHandler: e => console.error(e),
    });
    setOCRProgress(null);
    stopAndClose();
    props.onOCR(result.data.text);
  };*/

  const handleVideoSnapClicked = React.useCallback(async () => {
    if (!videoRef.current) return;
    try {
      const file = await renderVideoFrameAsPNGFile(videoRef.current, 'camera');
      onAttachImage(file);
      stopAndClose();
    } catch (error) {
      console.error('Error capturing video frame:', error);
    }
  }, [onAttachImage, stopAndClose, videoRef]);

  const handleVideoDownloadClicked = React.useCallback(() => {
    if (!videoRef.current) return;
    downloadVideoFrameAsPNG(videoRef.current, 'camera');
  }, [videoRef]);


  return (
    <Modal open onClose={stopAndClose} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

      <Box sx={{
        display: 'flex', flexDirection: 'column', m: 1,
        borderRadius: 'md', overflow: 'hidden',
        boxShadow: 'sm',
      }}>

        {/* Top bar */}
        <Sheet variant='solid' invertedColors sx={{ display: 'flex', justifyContent: 'space-between', p: 1 }}>
          <Select
            variant='soft'
            color='neutral'
            value={cameraIdx} onChange={(_event: any, value: number | null) => setCameraIdx(value === null ? -1 : value)}
            indicator={<KeyboardArrowDownIcon />}
          >
            <Option value={-1}>
              No Camera
            </Option>
            {cameras.map((device: MediaDeviceInfo, camIndex) => (
              <Option key={'video-dev-' + camIndex} value={camIndex}>
                {/*{device.label?.includes('Face') ? <CameraFrontIcon />*/}
                {/*  : device.label?.includes('tual') ? <CameraRearIcon />*/}
                {/*    : null}*/}
                {device.label?.replace('camera2 ', 'Camera ').replace('front', 'Front').replace('back', 'Back')}
              </Option>
            ))}
          </Select>

          <ModalClose onClick={stopAndClose} sx={{ position: 'static' }} />
        </Sheet>

        {/* (main) Video */}
        <Box sx={{ position: 'relative' }}>
          <video
            ref={videoRef} autoPlay playsInline
            style={{
              display: 'block', width: '100%', maxHeight: 'calc(100vh - 200px)',
              background: '#8888', //opacity: ocrProgress !== null ? 0.5 : 1,
            }}
          />

          {showInfo && !!info && <Typography
            sx={{
              position: 'absolute', inset: 0, zIndex: 1, /* camera info on top of video */
              background: 'rgba(0,0,0,0.5)', color: 'white',
              whiteSpace: 'pre', overflowY: 'scroll',
            }}>
            {info}
          </Typography>}

          {/*{ocrProgress !== null && <CircularProgress sx={{ position: 'absolute', top: 'calc(50% - 34px / 2)', left: 'calc(50% - 34px / 2)', zIndex: 2 }} />}*/}
        </Box>

        {/* Bottom controls (zoom, ocr, download) & progress */}
        <Sheet variant='soft' sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>

          {!!error && <InlineError error={error} />}

          {zoomControl}

          {/*{ocrProgress !== null && <LinearProgress color='primary' determinate value={100 * ocrProgress} sx={{ px: 2 }} />}*/}

          <Box paddingBottom={zoomControl ? 1 : undefined} sx={captureButtonContainerSx}>

            {/* Info */}
            <IconButton disabled={!info} onClick={() => setShowInfo(info => !info)}>
              <InfoOutlinedIcon />
            </IconButton>

            {/*<Button disabled={ocrProgress !== null} fullWidth variant='solid' size='lg' onClick={handleVideoOCRClicked} sx={{ flex: 1, maxWidth: 260 }}>*/}
            {/*  Extract Text*/}
            {/*</Button>*/}

            {/* Capture */}
            <Button
              color='neutral'
              size='lg'
              onClick={handleVideoSnapClicked}
              endDecorator={<CameraEnhanceIcon />}
              sx={captureButtonSx}
            >
              Capture
            </Button>

            {/* Download */}
            <IconButton onClick={handleVideoDownloadClicked}>
              <DownloadIcon />
            </IconButton>

          </Box>
        </Sheet>

      </Box>
    </Modal>
  );
}