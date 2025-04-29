import { Chat } from "@/components/chat"; // Ensure path is correct

export default function HomePage() {
  return (
    <div className="flex items-center justify-center h-screen w-full p-5">
      <div className="w-full h-[calc(100vh-40px)] max-w-[832px] rounded-xl border border-white/20 backdrop-blur-md bg-white/50 dark:bg-white/30 shadow-xl overflow-hidden">
        <Chat />
      </div>
    </div>
  );
}
