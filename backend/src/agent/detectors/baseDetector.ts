/**
 * Base Architecture Detector
 *
 * 提供架构检测的基础功能和 SQL 执行工具
 */

import {
  IArchitectureDetector,
  DetectorContext,
  DetectorResult,
  DetectionEvidence,
  RenderingArchitectureType,
} from './types';

/**
 * SQL 查询结果接口
 */
interface QueryResult {
  columns: string[];
  rows: any[][];
}

/**
 * 基础检测器抽象类
 */
export abstract class BaseDetector implements IArchitectureDetector {
  abstract readonly name: string;
  abstract readonly targetType: RenderingArchitectureType;

  /**
   * 执行检测 - 子类必须实现
   */
  abstract detect(context: DetectorContext): Promise<DetectorResult>;

  /**
   * 执行 SQL 查询
   */
  protected async executeQuery(
    context: DetectorContext,
    sql: string
  ): Promise<QueryResult> {
    try {
      const result = await context.traceProcessorService.query(
        context.traceId,
        sql
      );
      return {
        columns: result.columns || [],
        rows: result.rows || [],
      };
    } catch (error: any) {
      console.warn(`[${this.name}] SQL query failed:`, error.message);
      return { columns: [], rows: [] };
    }
  }

  /**
   * 检查线程是否存在
   */
  protected async hasThread(
    context: DetectorContext,
    pattern: string
  ): Promise<{ exists: boolean; matches: string[] }> {
    const sql = `
      SELECT DISTINCT thread.name
      FROM thread
      WHERE thread.name LIKE '${pattern}'
      LIMIT 10
    `;
    const result = await this.executeQuery(context, sql);
    const matches = result.rows.map((row) => row[0] as string);
    return { exists: matches.length > 0, matches };
  }

  /**
   * 检查进程是否存在
   */
  protected async hasProcess(
    context: DetectorContext,
    pattern: string
  ): Promise<{ exists: boolean; matches: string[] }> {
    const sql = `
      SELECT DISTINCT process.name
      FROM process
      WHERE process.name LIKE '${pattern}'
      LIMIT 10
    `;
    const result = await this.executeQuery(context, sql);
    const matches = result.rows.map((row) => row[0] as string);
    return { exists: matches.length > 0, matches };
  }

  /**
   * 检查 slice 是否存在
   */
  protected async hasSlice(
    context: DetectorContext,
    pattern: string
  ): Promise<{ exists: boolean; count: number; samples: string[] }> {
    const sql = `
      SELECT slice.name, COUNT(*) as cnt
      FROM slice
      WHERE slice.name LIKE '${pattern}'
      GROUP BY slice.name
      ORDER BY cnt DESC
      LIMIT 5
    `;
    const result = await this.executeQuery(context, sql);
    const totalCount = result.rows.reduce(
      (sum, row) => sum + (row[1] as number),
      0
    );
    const samples = result.rows.map((row) => row[0] as string);
    return { exists: totalCount > 0, count: totalCount, samples };
  }

  /**
   * 创建检测证据
   */
  protected createEvidence(
    type: DetectionEvidence['type'],
    value: string,
    weight: number,
    source?: string
  ): DetectionEvidence {
    return { type, value, weight, source };
  }

  /**
   * 创建空结果 (未检测到)
   */
  protected createEmptyResult(): DetectorResult {
    return {
      type: 'UNKNOWN',
      confidence: 0,
      evidence: [],
    };
  }

  /**
   * 计算总置信度 (基于证据权重)
   */
  protected calculateConfidence(evidence: DetectionEvidence[]): number {
    if (evidence.length === 0) return 0;
    const totalWeight = evidence.reduce((sum, e) => sum + e.weight, 0);
    // 归一化到 0-1，最大权重为 1.0
    return Math.min(totalWeight, 1.0);
  }
}
