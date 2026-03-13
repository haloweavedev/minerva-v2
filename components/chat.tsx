'use client';

import { useChat } from '@ai-sdk/react';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import { toast } from 'sonner';
import React from 'react';

export function Chat() {
  const [input, setInput] = React.useState('');

  const {
    messages,
    sendMessage,
    status,
    stop,
  } = useChat({
    onError: (error) => {
      console.error("Chat error:", error);
      toast.error('An error occurred, please try again!');
    },
  });

  const handleSubmit = React.useCallback(() => {
    if (input.trim().length === 0) return;
    sendMessage({ text: input });
    setInput('');
  }, [input, sendMessage]);

  const handleQueryClick = React.useCallback((query: string) => {
    sendMessage({ text: query });
  }, [sendMessage]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex-1 flex flex-col overflow-hidden">
        <Messages
          status={status}
          messages={messages}
          onQueryClick={handleQueryClick}
        />
      </div>

      <div className="mt-auto">
        <div className="mx-auto px-5 py-4 w-full">
          <MultimodalInput
            input={input}
            setInput={setInput}
            handleSubmit={handleSubmit}
            status={status}
            stop={stop}
          />
        </div>
      </div>
    </div>
  );
}
