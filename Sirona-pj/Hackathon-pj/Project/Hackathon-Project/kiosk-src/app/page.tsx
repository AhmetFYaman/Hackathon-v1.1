"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useKioskStore } from "@/store/kioskStore";

export default function Home() {
  const router = useRouter();
  const resetSession = useKioskStore((s) => s.resetSession);

  useEffect(() => {
    resetSession();
    router.replace("/idle");
  }, []);

  return null;
}
