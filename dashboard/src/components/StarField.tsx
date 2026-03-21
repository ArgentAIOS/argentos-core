import { useMemo } from "react";

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}

export function StarField() {
  // Generate random stars
  const stars = useMemo(() => {
    const starArray: Star[] = [];
    for (let i = 0; i < 50; i++) {
      starArray.push({
        id: i,
        x: Math.random() * 100, // percentage
        y: Math.random() * 100,
        size: Math.random() * 3 + 1, // 1-4px
        duration: Math.random() * 3 + 2, // 2-5 seconds
        delay: Math.random() * 5, // 0-5 second delay
      });
    }
    return starArray;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full bg-white"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            animation: `twinkle ${star.duration}s ease-in-out infinite`,
            animationDelay: `${star.delay}s`,
            opacity: 0.6,
          }}
        />
      ))}

      {/* Shooting stars */}
      <div
        className="absolute w-1 h-1 bg-white rounded-full"
        style={{
          top: "20%",
          left: "-10%",
          animation: "shooting-star 3s linear infinite",
          animationDelay: "2s",
          boxShadow: "0 0 10px 2px rgba(255, 255, 255, 0.5)",
        }}
      />
      <div
        className="absolute w-1 h-1 bg-white rounded-full"
        style={{
          top: "60%",
          left: "-10%",
          animation: "shooting-star 4s linear infinite",
          animationDelay: "6s",
          boxShadow: "0 0 10px 2px rgba(255, 255, 255, 0.5)",
        }}
      />
    </div>
  );
}
