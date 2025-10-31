export type ServerItem = GuildItem | FolderItem;

export interface GuildItem {
        type: 'guild';
        id: string;
        name: string;
        color: string;
        unread?: boolean;
        mentions?: number;
        letter?: string;
}

export interface FolderItem {
        type: 'folder';
        id: string;
        name: string;
        color: string;
        collapsed: boolean;
        children: ServerItem[];
}

export interface ServerBarState {
        items: ServerItem[];
}

export interface DragPosition {
        visible: boolean;
        top: number;
        left: number;
        right: number;
}

export interface TooltipState {
        visible: boolean;
        text: string;
        x: number;
        y: number;
}

export type DropIntent = 'before' | 'after' | 'into';

export interface ServerBarCallbacks {
        onItemDragStart(event: DragEvent, item: ServerItem): void;
        onItemDragEnd(event: DragEvent, item: ServerItem): void;
        onItemDragOver(event: DragEvent, item: ServerItem): void;
        onItemDragLeave(event: DragEvent, item: ServerItem): void;
        onItemDrop(event: DragEvent, item: ServerItem): void;
        onItemMouseEnter(event: MouseEvent, item: ServerItem): void;
        onItemMouseLeave(event: MouseEvent, item: ServerItem): void;
        onItemMouseMove(event: MouseEvent, item: ServerItem): void;
        onFolderToggle(folder: FolderItem): void;
}
