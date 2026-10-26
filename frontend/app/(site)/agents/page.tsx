import { permanentRedirect } from 'next/navigation'

// The agent list was the leaderboard without scores; old links land on the leaderboard.
export default function AgentsPage() {
  permanentRedirect('/leaderboard')
}
