import React, { useCallback } from "react";
import { 
  Button, 
  Text, 
  Box, 
  TrashIcon,
  LoadingIndicator,
} from "@canva/app-ui-kit";
import { useSelection } from "utils/use_selection_hook";
import { getTemporaryUrl } from "@canva/asset";

interface ImageCardProps {
  onImageRemove?: () => void;
  selectedImage?: string | null;
  isLoading?: boolean;
  onImageSelect?: (imageUrl: string) => void;
}

export const ImageCard: React.FC<ImageCardProps> = ({
  onImageRemove,
  selectedImage,
  isLoading,
  onImageSelect
}) => {
  const selection = useSelection("image");
  const [isProcessing, setIsProcessing] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const previousSelectionRef = React.useRef<string | null>(null);

  const handleImageClick = useCallback(async () => {
    // Don't process if we're already processing or no onImageSelect handler
    if (isProcessing || !onImageSelect) {
      return;
    }

    try {
      setIsProcessing(true);

      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Check if we have a valid selection
      if (!selection) {
        console.warn("No selection available");
        return;
      }

      // Force read the current selection
      let draft;
      try {
        draft = await selection.read();
      } catch (readError) {
        console.error("Error reading selection:", readError);
        return;
      }

      // Validate draft contents
      if (!draft || !Array.isArray(draft.contents) || draft.contents.length === 0) {
        console.warn("Please select an image from your design first");
        return;
      }

      const content = draft.contents[0];
      if (!content || typeof content.ref !== 'string') {
        console.warn("Invalid image reference");
        return;
      }

      // Compare with previous selection
      const currentSelectionKey = content.ref;
      const isNewSelection = previousSelectionRef.current !== currentSelectionKey;
      
      // Only process if it's a new selection or we don't have a current image
      if (!isNewSelection && selectedImage) {
        return;
      }

      // Add a delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

      let urlData;
      try {
        urlData = await getTemporaryUrl({
          type: "image",
          ref: content.ref,
        });
      } catch (urlError: any) {
        if (urlError?.message?.includes('rate_limited')) {
          // Schedule a retry after delay
          timeoutRef.current = setTimeout(() => {
            handleImageClick();
          }, 2000);
          return;
        }
        throw urlError;
      }

      if (urlData && urlData.url) {
        previousSelectionRef.current = currentSelectionKey;
        onImageSelect(urlData.url);
      }
    } catch (error) {
      console.error("Error handling image selection:", error);
    } finally {
      setIsProcessing(false);
    }
  }, [selection, onImageSelect, isProcessing, selectedImage]);

  // Reset previous selection when image is removed
  React.useEffect(() => {
    if (!selectedImage) {
      previousSelectionRef.current = null;
    }
  }, [selectedImage]);

  // Clean up timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Handle selection changes with debounce
  React.useEffect(() => {
    if (selection && selection.count === 1) {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Set a new timeout for processing
      timeoutRef.current = setTimeout(() => {
        handleImageClick();
      }, 500); // 500ms debounce
    }
    
    // Cleanup on selection change or unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [selection, handleImageClick]);

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '240px',
    margin: 0,
    border: '1px solid var(--ui-kit-color-border-low)',
    borderRadius: '8px',
    background: 'var(--ui-kit-color-neutral-low)',
    overflow: 'hidden'
  };

  const imageContainerStyle: React.CSSProperties = {
    position: 'relative',
    height: '100%',
    width: '100%',
    overflow: 'hidden'
  };

  return (
    <div style={containerStyle}>
      {selectedImage ? (
        <div style={imageContainerStyle}>
          <img
            src={selectedImage}
            alt="Selected"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              background: 'var(--ui-kit-color-neutral-low)'
            }}
          />
          <div style={{
            position: 'absolute',
            top: 8,
            right: 8,
          }}>
            <Button
              variant="contrast"
              icon={TrashIcon}
              size="small"
              onClick={() => {
                if (onImageRemove) {
                  onImageRemove();
                  previousSelectionRef.current = null;
                }
              }}
              tooltipLabel="Remove"
              ariaLabel="Remove"
            />
          </div>
        </div>
      ) : (
        <div 
          onClick={handleImageClick}
          onKeyPress={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleImageClick();
            }
          }}
          role="button"
          tabIndex={0}
          style={{ 
            cursor: isProcessing ? 'wait' : 'pointer',
            height: '100%',
            width: '100%',
            background: 'var(--ui-kit-color-neutral-low)'
          }}
        >
        <Box
          padding="2u"
          display="flex"
          height="full"
          alignItems="center"
          justifyContent="center"
          width="full"
        >
            {isLoading || isProcessing ? (
            <LoadingIndicator size="medium" />
          ) : (
            <Text size="small" tone="tertiary" alignment="center">
              Upload or select an image to review
            </Text>
          )}
        </Box>
        </div>
      )}
    </div>
  );
}; 