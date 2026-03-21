import { useMemo } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}

export function MorningParticles() {
  // Generate floating dust particles
  const particles = useMemo(() => {
    const particleArray: Particle[] = [];
    for (let i = 0; i < 30; i++) {
      particleArray.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 4 + 2, // 2-6px
        duration: Math.random() * 10 + 15, // 15-25 seconds (slow float)
        delay: Math.random() * 10,
      });
    }
    return particleArray;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Light rays */}
      <div
        className="absolute top-0 right-0 w-1/2 h-full opacity-10"
        style={{
          background:
            "linear-gradient(135deg, transparent 0%, rgba(255, 223, 186, 0.3) 50%, transparent 100%)",
          animation: "light-ray 20s ease-in-out infinite",
        }}
      />
      <div
        className="absolute top-0 left-0 w-1/3 h-full opacity-10"
        style={{
          background:
            "linear-gradient(45deg, transparent 0%, rgba(255, 245, 200, 0.2) 50%, transparent 100%)",
          animation: "light-ray 25s ease-in-out infinite",
          animationDelay: "5s",
        }}
      />

      {/* Floating dust particles */}
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute rounded-full bg-white"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            animation: `float-up ${particle.duration}s linear infinite`,
            animationDelay: `${particle.delay}s`,
            opacity: 0.4,
            filter: "blur(1px)",
          }}
        />
      ))}
    </div>
  );
}
