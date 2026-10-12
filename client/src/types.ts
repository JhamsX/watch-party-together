export interface Room {
  id: string; code: string; name: string; isPublic: boolean; hasPassword: boolean;
  allowEveryoneControls: boolean; currentVideoUrl: string | null; currentVideoTitle: string | null; createdAt: string;
}
export interface Participant { socketId: string; participantId: string; name: string; isHost: boolean; userId: string | null; joinedAt: string; }
export interface Playback { playing: boolean; position: number; updatedAt: number; sequence: number; videoUrl?: string; videoTitle?: string; action?: string; }
export interface VideoItem { id: string; roomId?: string; playlistId?: string; url: string; title: string; provider: string; position: number; addedBy?: string; createdAt: string; }
export interface ChatMessage { id: string; roomId: string; userId?: string | null; displayName: string; content: string; kind: 'chat' | 'reaction' | 'system'; createdAt: string; }
