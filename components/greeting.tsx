'use client'; // Keep client directive for framer-motion

import { motion } from 'framer-motion';

export const Greeting = () => {
  return (
    <div
      key="overview"
      className="max-w-3xl mx-auto md:mt-20 size-full flex flex-col justify-end"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.1 }} // Faster delay
        className="text-[33px] font-semibold"
      >
        Say &ldquo;Hi&rdquo; to
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.2 }} // Faster delay
        className="text-[63px] font-semibold bg-gradient-to-r from-[#7F85C1] to-[#FF66C4] bg-clip-text text-transparent"
      >
        Minerva
      </motion.div>
    </div>
  );
}; 