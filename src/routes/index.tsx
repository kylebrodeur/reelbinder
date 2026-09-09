import { createFileRoute } from "@tanstack/react-router";
import { SlateApp } from "@/components/app/slate-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <SlateApp />;
}
