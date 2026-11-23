// Audio file extensions Chud Tiles opens (desktop scan, file dialogs, drag and drop, browser).
// The page decodes most of them itself; the others go through FFmpeg on the desktop.

export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'aac', 'm4a', 'mp4', 'aiff', 'aif', 'aifc', 'wma', 'webm', 'alac', 'ape', 'wv', 'caf'];

export const isAudioName = (name: string): boolean => AUDIO_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '');
