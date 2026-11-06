import type ExcelJS from 'exceljs';
import type { EnterpriseProfile } from '../../src/modules/import/domain/enterprise-workbook';

type Sheet = EnterpriseProfile['sheets'][number];
export type MappingReview = {
    profile: EnterpriseProfile;
    fields: { code: Exclude<Sheet['columns'][string], 'ignore' | null>; label: string }[];
    sheets: {
        index: number; name: string; rows: number; columns: number; hidden: boolean;
        manualHeader: boolean; target: Sheet['target']; operation: string; priceUnit: string;
        blocks: { row: number; endRow: number; target: Sheet['target'] | 'inherit';
            columns: { column: number; header: string; key: string; excluded: boolean; field: Sheet['columns'][string] }[] }[];
    }[];
};
export function createMappingReview(workbook: ExcelJS.Workbook): Promise<MappingReview>;
export function renderMappingReview(review: MappingReview): string;
export function prepareMappingReview(input: string, options?: { workspaceRoot?: string }): Promise<{
    code: 'MAPPING_REVIEW_READY'; sheets: number; blocks: number; columns: number;
    unresolvedTargets: number; unresolvedColumns: number; excludedColumns: number;
}>;
export function main(args?: string[]): Promise<number>;
