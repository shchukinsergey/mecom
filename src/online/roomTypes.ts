import type { OnlineGameSettings } from './gameSettings';
import type { PeriodMacroParams } from '../engine/types';

export interface AccountUser { id: string; login: string; }
export type RoomVisibility = 'public' | 'link';
export type RoomPhase = 'lobby' | 'collecting' | 'complete' | 'closed';
export interface RoomSummary {
  id: string;
  name: string;
  ownerLogin: string;
  isOwner: boolean;
  visibility: RoomVisibility;
  phase: RoomPhase;
  currentPeriodIndex: number;
  playerCount: number;
  ownFirmId: string | null;
}
export interface RoomFirm {
  firmId: string;
  firmName: string;
  submitted: boolean;
  currentRif: number | null;
}
export interface RoomDetail extends RoomSummary {
  firms: RoomFirm[];
  settings: OnlineGameSettings;
  periodMacro: PeriodMacroParams | null;
  industryReport: string | null;
}
export interface CreateRoomInput {
  name: string;
  visibility: RoomVisibility;
  settings?: OnlineGameSettings;
}
export interface CalculatePreview {
  periodIndex: number;
  canCalculate: boolean;
  canForce: boolean;
  firms: Array<{
    firmId: string;
    firmName: string;
    submitted: boolean;
    source: 'submitted' | 'draft' | 'previous' | 'missing';
    valid: boolean;
  }>;
}
