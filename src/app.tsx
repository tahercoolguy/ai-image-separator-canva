import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { 
  Button, 
  Rows, 
  Columns, 
  Text, 
  ChevronDownIcon, 
  ProgressBar, 
  LoadingIndicator, 
  Box, 
  Alert, 
  FlyoutMenu, 
  FlyoutMenuItem, 
  FlyoutMenuDivider, 
  CheckIcon, 
  FormField, 
  Select,
  ImageCard,
  Grid,
  MultilineInput,
  Title,
  Link,
  FileInput,
  FileInputItem,
  ReloadIcon,
  NumberInput
} from "@canva/app-ui-kit";
import { FormattedMessage, useIntl } from "react-intl";
import type { ImageMimeType, ImageRef } from "@canva/asset";
import * as styles from "styles/components.css";
import { upload } from "@canva/asset";
import { useAddElement } from "utils/use_add_element";
import { useSelection } from "utils/use_selection_hook";
import { getTemporaryUrl } from "@canva/asset";
import { auth } from "@canva/user";
import { requestOpenExternalUrl } from "@canva/platform";

const SUPPORTED_FORMATS = ["JPG", "JPEG", "PNG"];
const TOKEN_CHECK_INTERVAL = 3000; // Check tokens every 3 seconds

// Custom hook for continuous token checking
const useTokensCheck = (userId: string | null) => {
  const [tokensLeft, setTokensLeft] = useState<number | null>(null);
  const [isCheckingTokens, setIsCheckingTokens] = useState(false);
  const [isPaidUser, setIsPaidUser] = useState(false);
  const lastUpdateRef = useRef<number>(0);
  const DEBOUNCE_TIME = 500; // 500ms debounce for faster updates

  const checkUserPaymentStatus = useCallback(async (uid: string) => {
    try {
      const response = await fetch(`https://multiplewords.com/api/account/user_settings/${uid}`);
      const data = await response.json();
      if (data.status === 1 && data.user_info && data.user_info.length > 0) {
        const isPaid = data.user_info[0].is_user_paid;
        setIsPaidUser(isPaid);
        return isPaid;
      }
      return false;
    } catch (error) {
      return false;
    }
  }, []);

  const checkTokens = useCallback(async (uid: string) => {
    const now = Date.now();
    if (now - lastUpdateRef.current < DEBOUNCE_TIME) {
      return tokensLeft; // Return current tokens if debounced
    }

    setIsCheckingTokens(true);
    try {
      // First check if user is paid
      const isPaid = await checkUserPaymentStatus(uid);
      
      if (isPaid) {
        // If user is paid, set tokens to a high number to indicate unlimited
        setTokensLeft(999);
        return 999;
      } else {
        // If not paid, check tokens as usual
        const response = await fetch(`https://multiplewords.com/api/tokens_left/get/${uid}`);
        const data = await response.json();
        if (data.status === 1) {
          const tokenCount = data.credits.videos;
          setTokensLeft(tokenCount);
          lastUpdateRef.current = now;
          return tokenCount;
        } else {
          setTokensLeft(0);
          return 0;
        }
      }
    } catch (error) {
      setTokensLeft(0);
      return 0;
    } finally {
      setIsCheckingTokens(false);
    }
  }, [checkUserPaymentStatus, tokensLeft]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (userId) {
      checkTokens(userId); // Immediate check
      intervalId = setInterval(() => {
        checkTokens(userId);
      }, TOKEN_CHECK_INTERVAL);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [userId, checkTokens]);

  return { tokensLeft, isCheckingTokens, checkTokens, isPaidUser };
};

// Loading state component that displays a progress bar and a cancel button
const LoadingState = ({ onCancel, progress, intl }: { onCancel: () => void; progress: number; intl: ReturnType<typeof useIntl> }) => (
  <div style={{
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--color-background)',
    zIndex: 1000
  }}>
    <div style={{ width: '100%', maxWidth: '400px' }}>
      <Box padding="2u">
        <Rows spacing="2u" align="center">
          <Title size="small" alignment="center">
            {intl.formatMessage({
              defaultMessage: "AI Image Separator",
              description: "The name of the app displayed in the loading screen title"
            })}
          </Title>
          <Text size="small" alignment="center" tone="secondary">
            <FormattedMessage
              defaultMessage="Processing your image..."
              description="Loading message shown while the app is processing the user's image"
            />
          </Text>
          <Box width="full">
            <ProgressBar 
              value={progress} 
              size="medium"
            />
          </Box>
          <Text tone="secondary" size="small" alignment="center">
            <FormattedMessage
              defaultMessage="Please wait, this may take a while"
              description="Message shown below the progress bar to inform users that processing may take time"
            />
          </Text>
          <Box width="full">
            <Button 
              variant="secondary" 
              onClick={onCancel}
              stretch
            >
              {intl.formatMessage({
                defaultMessage: "Cancel",
                description: "Button label to cancel the image processing operation"
              })}
            </Button>
          </Box>
        </Rows>
      </Box>
    </div>
  </div>
);

export const App = () => {
  const intl = useIntl();
  const [selectedImage, setSelectedImage] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [numberOfLayers, setNumberOfLayers] = useState<number>(7);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isTokenCheckLoading, setIsTokenCheckLoading] = useState(false);
  const addElement = useAddElement();
  const currentSelection = useSelection("image");
  const [isCancelled, setIsCancelled] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [usedTokens, setUsedTokens] = useState(0);
  const [imageSource, setImageSource] = useState<"upload" | "selection" | null>(null);
  const [reviewImages, setReviewImages] = useState<{ url: string; imageRef: ImageRef }[]>([]);

  // Use the custom hook for token checking
  const { tokensLeft, isCheckingTokens, checkTokens, isPaidUser } = useTokensCheck(userId);

  const oauth = useMemo(() => auth.initOauth(), []);

  const retrieveAndSetToken = useCallback(async (forceRefresh = false) => {
    setAuthLoading(true);
    try {
      const tokenResponse = await oauth.getAccessToken({ forceRefresh });
      const token = tokenResponse?.token || null;
      setAccessToken(token);
      
      if (token) {
        try {
          const userResponse = await fetch('https://multiplewords.com/oauth/check-canva-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
          });
          const userData = await userResponse.json();
          const uid = userData.user_id.toString();
          setUserId(uid);
        } catch (error) {
          // Handle error silently
        }
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setAuthLoading(false);
    }
  }, [oauth]);

  const authorize = useCallback(async () => {
    setAuthLoading(true);
    try {
      await oauth.requestAuthorization();
      const tokenResponse = await oauth.getAccessToken();
      const token = tokenResponse?.token || null;
      setAccessToken(token);
      
      if (token) {
        try {
          const userResponse = await fetch('https://multiplewords.com/oauth/check-canva-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
          });
          const userData = await userResponse.json();
          const uid = userData.user_id.toString();
          setUserId(uid);
        } catch (error) {
          // Handle error silently
        }
      }
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setAuthLoading(false);
    }
  }, [oauth]);

  useEffect(() => {
    retrieveAndSetToken();
  }, [retrieveAndSetToken]);

  const handleFileSelection = (files: File[]) => {
    const file = files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageUrl = e.target?.result as string;
      setSelectedImage([imageUrl]);
      setImageSource("upload");
    };
    reader.readAsDataURL(file);
  };

  // Function to handle image selection from Canva
  const handleCanvaImageSelection = async () => {
    if (currentSelection.count === 0) {
      return;
    }
    
    try {
      const draft = await currentSelection.read();
      
      for (const content of draft.contents) {
        const { url } = await getTemporaryUrl({
          type: "image",
          ref: content.ref,
        });
        
        if (url) {
          setSelectedImage([url]);
          setImageSource("selection");
        }
      }
    } catch (error) {
      // Handle error silently
    }
  };

  // Watch for image selection changes
  useEffect(() => {
    if (currentSelection.count > 0) {
      handleCanvaImageSelection();
    } else if (currentSelection.count === 0 && imageSource === "selection") {
      setSelectedImage([]);
      setImageSource(null);
    }
  }, [currentSelection, imageSource]);

  const handleCancel = () => {
    setIsCancelled(true);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsLoading(false);
    setProgress(0);
  };

  const handleGenerate = async () => {
    if (selectedImage.length === 0) {
      alert(intl.formatMessage({
        defaultMessage: "Please select an image",
        description: "Alert message shown when user tries to generate layers without selecting an image"
      }));
      return;
    }

    if (numberOfLayers < 1 || numberOfLayers > 7) {
      alert(intl.formatMessage({
        defaultMessage: "Number of layers must be between 1 and 7",
        description: "Alert message shown when user enters an invalid number of layers"
      }));
      return;
    }

    if (!accessToken) {
      authorize();
      return;
    }

    if (!userId) {
      return;
    }

    // Check if user has enough tokens (unless they are a paid user)
    if (!isPaidUser && tokensLeft !== null && tokensLeft <= 0) {
      alert(intl.formatMessage({
        defaultMessage: "You don't have enough credits to separate image layers. Please get more credits to continue.",
        description: "Alert message shown when user doesn't have enough credits to perform the operation"
      }));
      return;
    }

    setReviewImages([]);
    setIsLoading(true);
    setProgress(0);
    setIsCancelled(false);
    abortControllerRef.current = new AbortController();
    
    try {
      setProgress(10);
      
      const response = await fetch(selectedImage[0]);
      const blob = await response.blob();
      
      const formData = new FormData();
      formData.append('file', blob, 'image.jpg');
      formData.append('number_of_layers', numberOfLayers.toString());
      formData.append('prompt', prompt || 'auto');
      formData.append('user_id', userId);
      formData.append('isPro', isPaidUser ? '1' : '0');
      
      setProgress(30);
      
      const apiResponse = await fetch('https://shorts.multiplewords.com/mwvideos/api/image_layers_separator', {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal
      });
      
      if (isCancelled) {
        return;
      }

      const result = await apiResponse.json();
      
      if (result.status !== 1) {
        throw new Error(result.message || 'Failed to process image');
      }
      
      setProgress(50);
      
      if (isCancelled) {
        return;
      }

      // Process all images from the result array
      const imageUrls = result.result || [];
      const uploadedImages: { url: string; imageRef: ImageRef }[] = [];

      for (let i = 0; i < imageUrls.length; i++) {
        if (isCancelled) {
          return;
        }

        const imageUrl = imageUrls[i];
        const imageResponse = await fetch(imageUrl);
        const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

        // Get the dimensions of the image
        const img = new Image();
        const getImageDimensions = new Promise<{width: number, height: number}>((resolve, reject) => {
          img.onload = () => {
            resolve({
              width: img.width,
              height: img.height
            });
          };
          img.onerror = () => reject(new Error('Failed to load image'));
        });
        img.src = imageUrl;
        
        const dimensions = await getImageDimensions;

        const image = await upload({
          type: "image",
          mimeType: mimeType as ImageMimeType,
          url: imageUrl,
          thumbnailUrl: imageUrl,
          width: dimensions.width,
          height: dimensions.height,
          aiDisclosure: "none",
        });

        await image.whenUploaded();
        uploadedImages.push({
          url: imageUrl,
          imageRef: image.ref as ImageRef
        });

        setProgress(50 + (i + 1) * (40 / imageUrls.length));
      }

      // Increment the used tokens counter
      setUsedTokens(prev => prev + 1);

      setReviewImages(uploadedImages);
      setProgress(100);

      if (userId && !isPaidUser) {
        await checkTokens(userId);
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Handle cancellation
        return;
      }
      alert(intl.formatMessage({
        defaultMessage: "Failed to generate image layers. Please try again.",
        description: "Error message shown when image layer separation fails"
      }));
    } finally {
      setTimeout(() => {
        setProgress(0);
        setIsLoading(false);
        setIsCancelled(false);
        abortControllerRef.current = null;
      }, 1000);
    }
  };

  const handleAddToDesign = async (imageData: { url: string; imageRef: ImageRef }) => {
    await addElement({
      type: "image",
      ref: imageData.imageRef,
      altText: {
        text: intl.formatMessage({
          defaultMessage: "Separated image layer",
          description: "Alt text for separated image layers added to the design"
        }),
        decorative: false
      }
    });
  };

  const handleStartOver = () => {
    setReviewImages([]);
    setSelectedImage([]);
    setPrompt("");
    setNumberOfLayers(7);
    setImageSource(null);
  };

  const openExternalUrl = async (url: string) => {
    if (url.includes('canva_pricing') && userId) {
      setIsTokenCheckLoading(true);
      let intervalId: NodeJS.Timeout;
      let timeoutId: NodeJS.Timeout;
      
      const initialTokenCount = await checkTokens(userId);
      
      if (initialTokenCount === undefined || initialTokenCount === null) {
        setIsTokenCheckLoading(false);
        return;
      }
      
      const stopChecking = () => {
        if (intervalId) clearInterval(intervalId);
        if (timeoutId) clearTimeout(timeoutId);
        setIsTokenCheckLoading(false);
      };
      
      intervalId = setInterval(async () => {
        const newTokens = await checkTokens(userId);
        
        if (newTokens === undefined || newTokens === null) {
          return;
        }
        
        if (newTokens > initialTokenCount) {
          stopChecking();
        }
      }, 2000);

      timeoutId = setTimeout(() => {
        stopChecking();
      }, 300000);
    }

    const response = await requestOpenExternalUrl({ url });
    if (response.status === "aborted") {
      setIsTokenCheckLoading(false);
    }
  };

  return (
    <div className={styles.scrollContainer}>
      {isTokenCheckLoading ? (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '24px',
          zIndex: 1000
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LoadingIndicator size="medium" />
            <Text size="large" variant="bold">
              <FormattedMessage
                defaultMessage="Checking your purchase..."
                description="Message shown while checking if user has purchased credits"
              />
            </Text>
          </div>
          <div style={{ width: '90%', maxWidth: '400px' }}>
            <Button 
              variant="secondary" 
              onClick={() => setIsTokenCheckLoading(false)}
              stretch
            >
              {intl.formatMessage({
                defaultMessage: "Go back",
                description: "Button label to return to the previous screen"
              })}
            </Button>
          </div>
        </div>
      ) : authError ? (
        <div style={{ color: 'red', padding: '16px', textAlign: 'center' }}>
          <Text>{authError}</Text>
          <Button variant="primary" onClick={authorize}>
            {intl.formatMessage({
              defaultMessage: "Retry Login",
              description: "Button label to retry authentication after an error"
            })}
          </Button>
        </div>
      ) : authLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
          <LoadingIndicator />
        </div>
      ) : isLoading ? (
        <LoadingState onCancel={handleCancel} progress={progress} intl={intl} />
      ) : reviewImages.length > 0 ? (
        <Rows spacing="2u">
          <Box padding="1u">
            <Grid columns={2} spacing="1.5u">
              {reviewImages.map((imageData, index) => (
                <Rows key={index} spacing="1u">
                  <ImageCard
                    ariaLabel={intl.formatMessage({
                      defaultMessage: "Layer {number}",
                      description: "Accessibility label for image layer cards"
                    }, { number: index + 1 })}
                    alt={intl.formatMessage({
                      defaultMessage: "Separated layer {number}",
                      description: "Alt text for separated image layer previews"
                    }, { number: index + 1 })}
                    thumbnailUrl={imageData.url}
                    borderRadius="standard"
                  />
                  <Button 
                    variant="primary" 
                    stretch 
                    onClick={() => handleAddToDesign(imageData)}
                  >
                    {intl.formatMessage({
                      defaultMessage: "Add to design",
                      description: "Button label to add a separated image layer to the design"
                    })}
                  </Button>
                </Rows>
              ))}
            </Grid>
          </Box>
          <Button variant="secondary" stretch onClick={handleStartOver} icon={ReloadIcon}>
            {intl.formatMessage({
              defaultMessage: "Start over",
              description: "Button label to reset the app and start a new image separation"
            })}
          </Button>
        </Rows>
      ) : (
        <Rows spacing="2u">
          <Rows spacing="2u">
            {/* Image Selection Section */}
            {selectedImage.length === 0 && (
              <>
                <FormField
                  label={
                    <FormattedMessage
                      defaultMessage="Upload or select an image in your design to edit"
                      description="Label for the file input field where users upload or select an image"
                    />
                  }
                  control={() => (
                    <FileInput
                      accept={["image/*"]}
                      aria-label={intl.formatMessage({
                        defaultMessage: "Choose file",
                        description: "Accessibility label for the file input button"
                      })}
                      stretchButton={true}
                      multiple={false}
                      onDropAcceptedFiles={(files) => handleFileSelection(files)}
                    />
                  )}
                />
                <Text size="small" tone="secondary">
                  <FormattedMessage
                    defaultMessage="Supported formats: {formats}, and other browser-supported formats"
                    description="Text showing which image formats are supported"
                    values={{ formats: SUPPORTED_FORMATS.join(", ") }}
                  />
                </Text>
              </>
            )}
            {selectedImage.length > 0 && (
              <>
                <div style={{ marginBottom: 8, marginLeft: 2, marginTop: 8 }}>
                  <Text size="medium" variant="bold">
                    {imageSource === "selection" ? (
                      <FormattedMessage
                        defaultMessage="Selected image"
                        description="Label shown above an image selected from the Canva design"
                      />
                    ) : (
                      <FormattedMessage
                        defaultMessage="Uploaded image"
                        description="Label shown above an image uploaded by the user"
                      />
                    )}
                  </Text>
                </div>
                <div style={{
                  position: 'relative',
                  width: '100%',
                  height: '200px',
                  background: 'var(--ui-kit-color-neutral-low)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  margin: '0 auto',
                }}>
                  <img
                    src={selectedImage[0]}
                    alt={intl.formatMessage({
                      defaultMessage: "Selected preview",
                      description: "Alt text for the selected image preview"
                    })}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      borderRadius: '8px',
                      width: '100%',
                      height: '100%',
                      display: 'block',
                    }}
                  />
                </div>
                {imageSource === "upload" && (
                  <div style={{ marginTop: 8, marginLeft: 2 }}>
                    <FileInputItem
                      label={(() => {
                        try {
                          const url = selectedImage[0];
                          if (url.startsWith('data:')) return 'uploaded_image.png';
                          return url.split('/').pop() || 'image.png';
                        } catch {
                          return 'image.png';
                        }
                      })()}
                      onDeleteClick={() => {
                        setSelectedImage([]);
                        setImageSource(null);
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </Rows>

          {/* Number of Layers Input Section */}
          <FormField
            label={
              <div style={{ padding: '8px 0 4px 2px', fontWeight: 500, fontSize: 14 }}>
                <FormattedMessage
                  defaultMessage="Number of Layers"
                  description="Label for the number input field where users specify how many layers to separate"
                />
              </div>
            }
            value={numberOfLayers}
            control={(props) => (
              <NumberInput
                {...props}
                min={1}
                max={7}
                onChange={(value) => {
                  setNumberOfLayers(value || 7);
                }}
              />
            )}
          />

          {/* Prompt Input Section */}
          <FormField
            label={
              <div style={{ padding: '8px 0 4px 2px', fontWeight: 500, fontSize: 14 }}>
                <FormattedMessage
                  defaultMessage="Prompt (Optional)"
                  description="Label for the optional prompt input field"
                />
              </div>
            }
            value={prompt}
            control={(props) => (
              <div style={{ minHeight: '120px', paddingBottom: 8 }}>
                <MultilineInput
                  {...props}
                  onChange={(value) => {
                    setPrompt(value);
                  }}
                  maxRows={5}
                  minRows={5}
                  autoGrow
                  placeholder={intl.formatMessage({
                    defaultMessage: "Leave empty for automatic separation or describe how you want to separate the layers",
                    description: "Placeholder text for the optional prompt input field"
                  })}
                />
              </div>
            )}
          />

          <Button
            variant="primary"
            stretch
            onClick={!accessToken ? authorize : handleGenerate}
            disabled={
              authLoading || 
              (!accessToken ? false : (selectedImage.length === 0 || (tokensLeft !== null && tokensLeft <= 0)))
            }
          >
            {!accessToken ? (
              authLoading ? (
                intl.formatMessage({
                  defaultMessage: "Signing in...",
                  description: "Button label shown while authentication is in progress"
                })
              ) : (
                intl.formatMessage({
                  defaultMessage: "Sign in to separate layers",
                  description: "Button label prompting user to sign in before using the app"
                })
              )
            ) : (
              intl.formatMessage({
                defaultMessage: "Separate Image Layers",
                description: "Button label to start the image layer separation process"
              })
            )}
          </Button>

          {accessToken && tokensLeft !== null && (
            <Rows spacing="2u">
              {tokensLeft <= 0 && !isPaidUser && (
                <Alert tone="warn" >
                  <Rows spacing="1u">
                    <Text size="small">
                      <FormattedMessage
                        defaultMessage="<b>You don't have enough credits</b> You need at least 1 credit to separate image layers."
                        description="Warning message shown when user doesn't have enough credits"
                        values={{
                          b: (chunks) => <b>{chunks}</b>
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Text size="small">
                          <Link
                            href={`https://saifs.ai/canva_pricing/${userId}/14`}
                            requestOpenExternalUrl={() => openExternalUrl(`https://saifs.ai/canva_pricing/${userId}/14`)}
                          >
                            <FormattedMessage
                              defaultMessage="Need more? Get more credits"
                              description="Link text to purchase more credits"
                            />
                          </Link>
                        </Text>
                        {isTokenCheckLoading && <LoadingIndicator size="small" />}
                      </div>
                    </Text>
                  </Rows>
                </Alert>
              )}
              
              <Rows spacing="1u">
                {(() => {
                  if (isPaidUser) {
                    return (
                      <Text size="small" alignment="center">
                        <FormattedMessage
                          defaultMessage="You have <b>unlimited</b> AI Image Separator credits"
                          description="Message shown to paid users indicating they have unlimited credits"
                          values={{
                            b: (chunks) => <b>{chunks}</b>
                          }}
                        />
                      </Text>
                    );
                  } else {
                    return (
                      <Text size="small" alignment="center">
                        <FormattedMessage
                          defaultMessage="Use {used} of {total} Nano Banana Saifs AI credits"
                          description="Message showing credit usage for non-paid users"
                          values={{
                            used: usedTokens,
                            total: tokensLeft
                          }}
                        />
                      </Text>
                    );
                  }
                })()}
                
                {!isPaidUser && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <Text size="small">
                      <FormattedMessage
                        defaultMessage="Need more? <link>Get more credits</link>"
                        description="Link text to purchase more credits for non-paid users"
                        values={{
                          link: (chunks) => (
                            <Link
                              href={`https://saifs.ai/canva_pricing/${userId}/14`}
                              requestOpenExternalUrl={() => openExternalUrl(`https://saifs.ai/canva_pricing/${userId}/14`)}
                            >
                              {chunks}
                            </Link>
                          )
                        }}
                      />
                    </Text>
                    {isTokenCheckLoading && <LoadingIndicator size="small" />}
                  </div>
                )}
              </Rows>
            </Rows>
          )}
        </Rows>
      )}
    </div>
  );
};