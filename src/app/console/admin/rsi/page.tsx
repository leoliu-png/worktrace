import { ConsolePageFrame } from '@/components/console-page-frame';
import { RsiConsole } from '@/components/rsi-console';
export const dynamic = 'force-dynamic';
export default async function RsiPage() {
  return <ConsolePageFrame title="自动优化" activePath="/console/admin/rsi" administratorOnly><RsiConsole /></ConsolePageFrame>;
}
