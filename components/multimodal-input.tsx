'use client';

import {
  useRef,
  useEffect,
  useCallback,
  memo,
  type ChangeEvent,
} from 'react';
import { toast } from 'sonner';
import { useLocalStorage } from 'usehooks-ts';
import { ArrowUpIcon, StopIcon } from './icons';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import type { UseChatHelpers } from '@ai-sdk/react';
import { cn } from '@/lib/utils';

// Simplified version without attachments and suggested actions
function PureMultimodalInput({
  input,
  setInput,
  status,
  stop,
  handleSubmit,
  className,
}: {
  input: UseChatHelpers['input'];
  setInput: UseChatHelpers['setInput'];
  status: UseChatHelpers['status'];
  stop: UseChatHelpers['stop'];
  handleSubmit: UseChatHelpers['handleSubmit'];
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = 200;
      textareaRef.current.style.height = `${Math.min(scrollHeight + 2, maxHeight)}px`;
    }
  }, []);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, []);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    'minerva-chat-input',
    '',
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const finalValue = domValue || localStorageInput || '';
      setInput(finalValue);
      requestAnimationFrame(adjustHeight);
    }
  }, [adjustHeight, localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
    requestAnimationFrame(adjustHeight);
  }, [input, setLocalStorageInput, adjustHeight]);

  const handleInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const submitForm = useCallback(() => {
    if (input.trim().length === 0) return;
    handleSubmit(undefined);
    setInput('');
    setLocalStorageInput('');
    resetHeight();
    textareaRef.current?.focus();
  }, [handleSubmit, input, setInput, setLocalStorageInput, resetHeight]);

  return (
    <form onSubmit={(e) => { e.preventDefault(); submitForm(); }} className="w-full">
      <div className="relative w-full flex flex-col">
        <Textarea
          data-testid="multimodal-input"
          ref={textareaRef}
          placeholder="Send a message..."
          value={input}
          onChange={handleInput}
          className={cn(
            'min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-2xl !text-base pb-10 w-full',
            'border-blob-purple focus-visible:border-blob-purple focus-visible:ring-blob-purple/30',
            'shadow-[0_0_10px_rgba(127,133,193,0.1)] backdrop-blur-sm bg-white/30 dark:bg-white/5',
            className,
          )}
          rows={1}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (status === 'streaming') {
                toast.error('Please wait for the model to finish its response!');
              } else {
                submitForm();
              }
            }
          }}
        />

        <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end">
          {status === 'streaming' ? (
            <StopButton stop={stop} />
          ) : (
            <SendButton
              input={input}
              submitForm={submitForm}
            />
          )}
        </div>
      </div>
    </form>
  );
}

// Simplified memoization
export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (prevProps.status !== nextProps.status) return false;
    return true;
  },
);

// Stop Button
function PureStopButton({ stop }: { stop: () => void }) {
  return (
    <Button
      data-testid="stop-button"
      variant="outline"
      size="icon"
      className="rounded-full p-1.5 h-8 w-8 border border-blob-purple backdrop-blur-sm bg-white/30 dark:bg-white/5 text-blob-purple dark:text-blob-purple hover:bg-blob-purple/10"
      onClick={(event) => {
        event.preventDefault();
        stop();
      }}
      aria-label="Stop generation"
    >
      <StopIcon size={14} />
    </Button>
  );
}
const StopButton = memo(PureStopButton);

// Send Button
function PureSendButton({
  submitForm,
  input,
}: {
  submitForm: () => void;
  input: string;
}) {
  return (
    <Button
      data-testid="send-button"
      variant="default"
      size="icon"
      className="rounded-full p-1.5 h-8 w-8 bg-blob-purple hover:bg-blob-purple/90 shadow-[0_0_10px_rgba(127,133,193,0.2)]"
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={input.trim().length === 0}
      aria-label="Send message"
    >
      <ArrowUpIcon size={14} />
    </Button>
  );
}
const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  return prevProps.input === nextProps.input;
}); 