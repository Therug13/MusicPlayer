import { createFileRoute } from "@tanstack/react-router";
import { Lobby } from "@/components/booth/lobby";

export const Route = createFileRoute("/")({ component: Lobby });
