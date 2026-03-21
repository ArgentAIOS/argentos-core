import { motion, type Transition } from "framer-motion";

type AvatarState = "idle" | "thinking" | "working" | "success" | "error";
type Expression = "happy" | "thinking" | "excited" | "wink" | "surprised";

interface AvatarProps {
  state: AvatarState;
  expression?: Expression;
  size?: number;
}

const stateColors = {
  idle: "#FFD700", // Gold
  thinking: "#A855F7", // Purple
  working: "#22C55E", // Green
  success: "#22C55E", // Green
  error: "#EF4444", // Red
};

const expressions: Record<Expression, { leftEye: string; rightEye: string; mouth: string }> = {
  happy: {
    leftEye: "M28 38 Q32 34 36 38",
    rightEye: "M64 38 Q68 34 72 38",
    mouth: "M35 60 Q50 75 65 60",
  },
  thinking: {
    leftEye: "M30 36 L36 36",
    rightEye: "M64 36 L70 36",
    mouth: "M40 62 Q50 58 60 62",
  },
  excited: {
    leftEye: "M28 34 Q32 28 36 34",
    rightEye: "M64 34 Q68 28 72 34",
    mouth: "M32 58 Q50 78 68 58",
  },
  wink: {
    leftEye: "M28 38 Q32 34 36 38",
    rightEye: "M64 36 L72 36",
    mouth: "M35 60 Q50 72 65 60",
  },
  surprised: {
    leftEye: "M32 32 A6 6 0 1 1 32 44 A6 6 0 1 1 32 32",
    rightEye: "M68 32 A6 6 0 1 1 68 44 A6 6 0 1 1 68 32",
    mouth: "M44 60 A8 8 0 1 1 56 60 A8 8 0 1 1 44 60",
  },
};

const stateToExpression: Record<AvatarState, Expression> = {
  idle: "happy",
  thinking: "thinking",
  working: "excited",
  success: "wink",
  error: "surprised",
};

// Define easing as const to satisfy TypeScript
const easeInOut = "easeInOut" as const;
const easeOut = "easeOut" as const;

export function Avatar({ state, expression, size = 160 }: AvatarProps) {
  const currentExpression = expression || stateToExpression[state];
  const face = expressions[currentExpression];
  const ringColor = stateColors[state];

  // Jiggly animation variants
  const jiggle: Record<
    AvatarState,
    { y?: number[]; x?: number[]; rotate?: number[]; scale?: number[]; transition: Transition }
  > = {
    idle: {
      y: [0, -4, 0],
      rotate: [0, -1, 0, 1, 0],
      transition: {
        y: { duration: 3, repeat: Infinity, ease: easeInOut },
        rotate: { duration: 4, repeat: Infinity, ease: easeInOut },
      },
    },
    thinking: {
      y: [0, -2, 0],
      rotate: [0, -2, 0],
      scale: [1, 0.98, 1],
      transition: {
        duration: 1.5,
        repeat: Infinity,
        ease: easeInOut,
      },
    },
    working: {
      y: [0, -6, 0],
      rotate: [0, -2, 0, 2, 0],
      transition: {
        duration: 0.8,
        repeat: Infinity,
        ease: easeInOut,
      },
    },
    success: {
      y: [0, -15, 0],
      scale: [1, 1.1, 1],
      transition: {
        duration: 0.5,
        ease: easeOut,
      },
    },
    error: {
      x: [-3, 3, -3, 3, 0],
      transition: {
        duration: 0.4,
        ease: easeInOut,
      },
    },
  };

  // Ring pulse animation
  const ringPulse: Record<
    AvatarState,
    { opacity: number | number[]; scale?: number[]; transition: Transition }
  > = {
    idle: {
      opacity: [0.6, 0.8, 0.6],
      scale: [1, 1.02, 1],
      transition: { duration: 3, repeat: Infinity, ease: easeInOut },
    },
    thinking: {
      opacity: [0.5, 1, 0.5],
      scale: [1, 1.05, 1],
      transition: { duration: 1.2, repeat: Infinity, ease: easeInOut },
    },
    working: {
      opacity: [0.7, 1, 0.7],
      scale: [1, 1.03, 1],
      transition: { duration: 0.6, repeat: Infinity, ease: easeInOut },
    },
    success: {
      opacity: 1,
      scale: [1, 1.1, 1],
      transition: { duration: 0.5 },
    },
    error: {
      opacity: [1, 0.5, 1],
      transition: { duration: 0.2, repeat: 3 },
    },
  };

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Status Ring */}
      <motion.div
        className="absolute inset-0 rounded-full status-ring"
        style={{
          border: `4px solid ${ringColor}`,
          color: ringColor,
        }}
        animate={ringPulse[state]}
      />

      {/* Outer glow */}
      <motion.div
        className="absolute inset-2 rounded-full"
        style={{
          background: `radial-gradient(circle, ${ringColor}20 0%, transparent 70%)`,
        }}
        animate={ringPulse[state]}
      />

      {/* Face Container */}
      <motion.div
        className="absolute inset-4 rounded-full flex items-center justify-center"
        style={{
          background: "linear-gradient(145deg, #FFE066, #FFCC00)",
          boxShadow: "inset 0 -8px 20px rgba(0,0,0,0.15), 0 4px 20px rgba(0,0,0,0.3)",
        }}
        animate={jiggle[state]}
      >
        {/* Face SVG */}
        <svg viewBox="0 0 100 100" className="w-full h-full p-2">
          {/* Eyes */}
          <motion.path
            d={face.leftEye}
            fill="none"
            stroke="#333"
            strokeWidth="4"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.3 }}
          />
          <motion.path
            d={face.rightEye}
            fill="none"
            stroke="#333"
            strokeWidth="4"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.3 }}
          />

          {/* Mouth */}
          <motion.path
            d={face.mouth}
            fill="none"
            stroke="#333"
            strokeWidth="4"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          />

          {/* Blush (for happy/excited states) */}
          {(currentExpression === "happy" || currentExpression === "excited") && (
            <>
              <circle cx="22" cy="50" r="8" fill="#FF9999" opacity="0.4" />
              <circle cx="78" cy="50" r="8" fill="#FF9999" opacity="0.4" />
            </>
          )}
        </svg>
      </motion.div>
    </div>
  );
}
