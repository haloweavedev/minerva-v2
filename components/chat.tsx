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
    <div className="flex flex-col h-dvh bg-background">
      {/* Removed ChatHeader */}
      <Messages
        status={status}
        messages={messages}
        // Removed props: chatId, votes, setMessages, reload, isReadonly, isArtifactVisible
      />

      <form className="flex mx-auto px-4 bg-background pb-4 md:pb-6 gap-2 w-full md:max-w-3xl">
        <MultimodalInput
          input={input}
          setInput={setInput}
          handleSubmit={handleSubmit}
          status={status}
          stop={stop}
          // Removed props: chatId, attachments, setAttachments, messages, setMessages, append
        />
      </form>
    </div>
  );
} 