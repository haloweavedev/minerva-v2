"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Blob {
  id: number;
  x: string;
  y: string;
  size: string;
  borderRadius: string;
  gradient: string;
  duration: number;
  delay: number;
}

interface FloatingGradientBackgroundProps {
  numberOfBlobs?: number;
  blurStrength?: number;
  className?: string;
}

export default function FloatingGradientBackground({
  numberOfBlobs = 6,
  blurStrength = 100,
  className = "",
}: FloatingGradientBackgroundProps) {
  const [blobs, setBlobs] = useState<Blob[]>([]);

  // Generate random blobs on mount
  useEffect(() => {
    const generatedBlobs: Blob[] = [];
    
    for (let i = 0; i < numberOfBlobs; i++) {
      const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
      
      // Generate random properties for each blob
      const size = isMobile 
        ? `${Math.floor(Math.random() * 30) + 20}vw` 
        : window.innerWidth >= 1024 
          ? `${Math.floor(Math.random() * 200) + 200}px`
          : `${Math.floor(Math.random() * 150) + 150}px`;
          
      const x = `${Math.floor(Math.random() * 100)}vw`;
      const y = `${Math.floor(Math.random() * 100)}vh`;
      
      // Generate organic border radius
      const br1 = Math.floor(Math.random() * 40) + 30;
      const br2 = Math.floor(Math.random() * 40) + 30;
      const br3 = Math.floor(Math.random() * 40) + 30;
      const br4 = Math.floor(Math.random() * 40) + 30;
      const borderRadius = `${br1}% ${br2}% ${br3}% ${br4}%`;
      
      // Create gradient with random angle
      const angle = Math.floor(Math.random() * 360);
      const gradient = `linear-gradient(${angle}deg, var(--blob-purple), var(--blob-pink))`;
      
      // Random animation duration and delay
      const duration = Math.floor(Math.random() * 20) + 20; // 20-40s
      const delay = i * -2; // Stagger the animations
      
      generatedBlobs.push({
        id: i,
        x,
        y,
        size,
        borderRadius,
        gradient,
        duration,
        delay,
      });
    }
    
    setBlobs(generatedBlobs);
  }, [numberOfBlobs]);

  return (
    <div className={`fixed inset-0 overflow-hidden -z-10 fgb-wrapper ${className}`}>
      {blobs.map((blob) => (
        <motion.div
          key={blob.id}
          className="absolute fgb-blob will-change-transform"
          style={{
            left: blob.x,
            top: blob.y,
            width: blob.size,
            height: blob.size,
            background: blob.gradient,
            borderRadius: blob.borderRadius,
            filter: `blur(${blurStrength}px)`,
            opacity: 0.7,
          }}
          initial={{ scale: 0.8 }}
          animate={{
            x: [
              `calc(${Math.random() * 20 - 10}vw)`, 
              `calc(${Math.random() * 20 - 10}vw)`, 
              `calc(${Math.random() * 20 - 10}vw)`
            ],
            y: [
              `calc(${Math.random() * 20 - 10}vh)`, 
              `calc(${Math.random() * 20 - 10}vh)`, 
              `calc(${Math.random() * 20 - 10}vh)`
            ],
            borderRadius: [
              blob.borderRadius,
              `${Math.floor(Math.random() * 40) + 30}% ${Math.floor(Math.random() * 40) + 30}% ${Math.floor(Math.random() * 40) + 30}% ${Math.floor(Math.random() * 40) + 30}%`,
              blob.borderRadius
            ],
            scale: [1, 1.05, 0.95, 1],
            rotate: [0, 5, -5, 0],
          }}
          transition={{
            duration: blob.duration,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
            repeatType: "reverse",
            delay: blob.delay,
          }}
        />
      ))}
    </div>
  );
} 