import { Chat } from "@/components/chat";

export default function HomePage() {
  return (
    <div className="flex items-center justify-center h-dvh w-full noise-overlay">
      <div className="w-full h-full max-w-[880px] overflow-hidden">
        <Chat />
      </div>
    </div>
  );
}
