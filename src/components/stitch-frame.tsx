import { readStitchScreen, type StitchScreen } from '@/lib/stitch-source';
import { StitchRuntimeFrame } from './stitch-runtime-frame';

type StitchFrameUser = { name: string; email: string; image: string | null; role: 'ADMIN' | 'MEMBER' };

export function StitchFrame({ screen, title, user }: { screen: StitchScreen; title: string; user: StitchFrameUser }) {
  return <StitchRuntimeFrame title={title} source={readStitchScreen(screen, user)} user={user} />;
}
