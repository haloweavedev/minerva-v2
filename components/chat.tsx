'use client';

import { useChat } from '@ai-sdk/react';
import { generateUUID } from '@/lib/utils';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import { toast } from 'sonner';
import React from 'react';

// Simplified Chat component
export function Chat() {
  // Generate a unique ID for this ephemeral chat session on the client
  // Note: This ID won't persist across refreshes.
  const chatId = React.useMemo(() => generateUUID(), []);

  const {
    messages,
    handleSubmit,
    input,
    setInput,
    status,
    stop,
  } = useChat({
    id: chatId, // Use the generated ephemeral ID
    generateId: generateUUID, // Keep for message IDs
    onError: (error) => {
      console.error("Chat error:", error);
      toast.error('An error occurred, please try again!');
    },
  });

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex-1 overflow-hidden">
        <Messages
          status={status}
          messages={messages}
        />
      </div>

      <div className="mt-auto pt-2">
        <div className="mx-auto px-5 py-3 w-full">
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