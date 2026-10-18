import type { OnlineGameSettings } from './gameSettings';
import type { PeriodMacroParams } from '../engine/types';

export interface PublicHistoryPeriod {
  periodIndex: number;
  firms: Array<{
    firmId: string;
    firmName: string;
    excluded?: true;
    rif: number;
    netProfit: number;
    marketShareSold: number;
    revenue: number;
    retainedEarnings: number;
  }>;
}

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
  isBot?: true;
  submitted: boolean;
  currentRif: number | null;
  nativeBankrupt?: true;
}
export interface RoomDetail extends RoomSummary {
  nativeBankruptcyAvailable?: boolean;
  firms: RoomFirm[];
  settings: OnlineGameSettings;
  periodMacro: PeriodMacroParams | null;
  industryReport: string | null;
}
export interface CreateRoomInput {
  name: string;
  visibility: RoomVisibility;
  settings?: OnlineGameSettings;
  addBot?: boolean;
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
