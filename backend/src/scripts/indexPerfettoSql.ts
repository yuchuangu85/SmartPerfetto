/**
 * Perfetto SQL 索引脚本
 * 扫描官方 stdlib 和 metrics 目录，提取 SQL 模板信息
 */

import * as fs from 'fs';
import * as path from 'path';

// SQL 模板接口
interface PerfettoSqlTemplate {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  type: 'table' | 'view' | 'function' | 'macro' | 'metric';
  description: string;
  sql: string;
  filePath: string;
  dependencies: string[];
  params?: string[];
  returnType?: string;
  columns?: Array<{ name: string; type: string; description: string }>;
}

// 分析场景接口
interface AnalysisScenario {
  id: string;
  name: string;
  description: string;
  category: string;
  templates: string[];
  order: number;
}

// Perfetto SQL 根目录
const PERFETTO_ROOT = path.join(__dirname, '../../../perfetto/perfetto');
const STDLIB_PATH = path.join(PERFETTO_ROOT, 'src/trace_processor/perfetto_sql/stdlib');
const METRICS_PATH = path.join(PERFETTO_ROOT, 'src/trace_processor/metrics/sql');

// 输出目录
const OUTPUT_DIR = path.join(__dirname, '../../data');

/**
 * 解析 SQL 文件，提取元数据
 */
function parseSqlFile(filePath: string, relativePath: string): PerfettoSqlTemplate[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const templates: PerfettoSqlTemplate[] = [];

  // 提取路径信息
  const pathParts = relativePath.split('/');
  const category = pathParts[0] || 'general';
  const subcategory = pathParts.slice(1, -1).join('/') || '';
  const fileName = path.basename(filePath, '.sql');

  // 提取依赖
  const dependencies: string[] = [];
  const includeMatches = content.matchAll(/INCLUDE PERFETTO MODULE ([^;]+);/g);
  for (const match of includeMatches) {
    dependencies.push(match[1].trim());
  }
  const runMetricMatches = content.matchAll(/RUN_METRIC\(['"]([^'"]+)['"]\)/g);
  for (const match of runMetricMatches) {
    dependencies.push(`metric:${match[1]}`);
  }

  // 提取 CREATE PERFETTO TABLE
  const tableRegex = /--\s*(.+?)(?:\n--\s*(.+?))?\nCREATE PERFETTO TABLE\s+(\w+)\s*\(([^)]+)\)\s*AS/gs;
  let match;
  while ((match = tableRegex.exec(content)) !== null) {
    const description = (match[1] + (match[2] ? ' ' + match[2] : '')).trim();
    const tableName = match[3];
    const columnsDef = match[4];

    // 解析列定义
    const columns = parseColumns(columnsDef);

    templates.push({
      id: `stdlib.${category}.${subcategory ? subcategory.replace(/\//g, '.') + '.' : ''}${tableName}`,
      name: tableName,
      category,
      subcategory,
      type: 'table',
      description: description.replace(/^--\s*/gm, ''),
      sql: extractDefinition(content, match.index!, 'TABLE'),
      filePath: relativePath,
      dependencies,
      columns
    });
  }

  // 提取 CREATE PERFETTO VIEW
  const viewRegex = /--\s*(.+?)(?:\n--\s*(.+?))?\nCREATE PERFETTO VIEW\s+(\w+)\s*\(/gs;
  while ((match = viewRegex.exec(content)) !== null) {
    const description = (match[1] + (match[2] ? ' ' + match[2] : '')).trim();
    const viewName = match[3];

    templates.push({
      id: `stdlib.${category}.${subcategory ? subcategory.replace(/\//g, '.') + '.' : ''}${viewName}`,
      name: viewName,
      category,
      subcategory,
      type: 'view',
      description: description.replace(/^--\s*/gm, ''),
      sql: extractDefinition(content, match.index!, 'VIEW'),
      filePath: relativePath,
      dependencies
    });
  }

  // 提取 CREATE PERFETTO FUNCTION
  const funcRegex = /--\s*(.+?)(?:\n--\s*(.+?))?\nCREATE PERFETTO FUNCTION\s+(\w+)\s*\(([^)]*)\)\s*RETURNS\s+(\w+(?:\s*\([^)]*\))?)/gs;
  while ((match = funcRegex.exec(content)) !== null) {
    const description = (match[1] + (match[2] ? ' ' + match[2] : '')).trim();
    const funcName = match[3];
    const params = parseParams(match[4]);
    const returnType = match[5];

    templates.push({
      id: `stdlib.${category}.${subcategory ? subcategory.replace(/\//g, '.') + '.' : ''}${funcName}`,
      name: funcName,
      category,
      subcategory,
      type: 'function',
      description: description.replace(/^--\s*/gm, ''),
      sql: extractDefinition(content, match.index!, 'FUNCTION'),
      filePath: relativePath,
      dependencies,
      params,
      returnType
    });
  }

  // 如果没有解析到具体定义，将整个文件作为一个模板
  if (templates.length === 0 && content.includes('SELECT')) {
    const headerComment = content.match(/^--\s*(.+?)(?:\n--\s*(.+?))*\n/);
    const description = headerComment
      ? headerComment[0].replace(/^--\s*/gm, '').trim().split('\n').slice(0, 2).join(' ')
      : fileName;

    templates.push({
      id: `${relativePath.includes('metrics') ? 'metric' : 'stdlib'}.${category}.${fileName}`,
      name: fileName,
      category,
      subcategory,
      type: relativePath.includes('metrics') ? 'metric' : 'view',
      description,
      sql: content,
      filePath: relativePath,
      dependencies
    });
  }

  return templates;
}

/**
 * 解析列定义
 */
function parseColumns(columnsDef: string): Array<{ name: string; type: string; description: string }> {
  const columns: Array<{ name: string; type: string; description: string }> = [];
  const lines = columnsDef.split('\n');

  for (const line of lines) {
    // 匹配: column_name TYPE -- description 或 column_name TYPE,
    const match = line.match(/^\s*--\s*(.+)|^\s*(\w+)\s+(\w+(?:\([^)]+\))?)/);
    if (match) {
      if (match[2]) {
        // 找到列定义
        const prevLine = lines[lines.indexOf(line) - 1];
        const description = prevLine?.trim().startsWith('--')
          ? prevLine.replace(/^\s*--\s*/, '').trim()
          : '';
        columns.push({
          name: match[2],
          type: match[3],
          description
        });
      }
    }
  }

  return columns;
}

/**
 * 解析函数参数
 */
function parseParams(paramsDef: string): string[] {
  if (!paramsDef.trim()) return [];

  return paramsDef.split(',').map(p => {
    const parts = p.trim().split(/\s+/);
    return parts[0]; // 返回参数名
  }).filter(Boolean);
}

/**
 * 提取完整定义
 */
function extractDefinition(content: string, startIndex: number, type: string): string {
  // 向前查找注释
  let commentStart = startIndex;
  const lines = content.substring(0, startIndex).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith('--')) {
      commentStart = content.indexOf(lines[i]);
    } else if (lines[i].trim()) {
      break;
    }
  }

  // 向后查找定义结束（到下一个 CREATE 或文件末尾）
  const nextCreate = content.indexOf('\nCREATE', startIndex + 1);
  const endIndex = nextCreate > 0 ? nextCreate : content.length;

  return content.substring(commentStart, endIndex).trim();
}

/**
 * 递归扫描目录
 */
function scanDirectory(dir: string, baseDir: string): PerfettoSqlTemplate[] {
  const templates: PerfettoSqlTemplate[] = [];

  if (!fs.existsSync(dir)) {
    console.warn(`Directory not found: ${dir}`);
    return templates;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      templates.push(...scanDirectory(fullPath, baseDir));
    } else if (entry.name.endsWith('.sql')) {
      const relativePath = path.relative(baseDir, fullPath);
      try {
        const fileTemplates = parseSqlFile(fullPath, relativePath);
        templates.push(...fileTemplates);
      } catch (error) {
        console.error(`Error parsing ${fullPath}:`, error);
      }
    }
  }

  return templates;
}

/**
 * 生成预制分析场景
 */
function generateAnalysisScenarios(templates: PerfettoSqlTemplate[]): AnalysisScenario[] {
  const scenarios: AnalysisScenario[] = [
    {
      id: 'app_startup',
      name: '应用启动分析',
      description: '分析应用冷启动/热启动性能，包括 TTID、TTFD、各阶段耗时',
      category: 'startup',
      templates: [
        'stdlib.android.startup.android_startups',
        'stdlib.android.startup.android_startup_threads',
        'stdlib.android.startup.android_thread_slices_for_all_startups',
        'stdlib.android.startup.android_slices_for_startup_and_slice_name'
      ],
      order: 1
    },
    {
      id: 'frame_jank',
      name: '帧渲染卡顿分析',
      description: '分析帧渲染性能，检测卡顿帧和掉帧原因',
      category: 'frame',
      templates: [
        'stdlib.android.frames.android_frame_stats',
        'stdlib.android.frames.android_frames_overrun',
        'stdlib.android.frames.android_frames_ui_time',
        'stdlib.android.frames.android_cpu_time_per_frame'
      ],
      order: 2
    },
    {
      id: 'memory_analysis',
      name: '内存分析',
      description: '分析内存使用情况，包括堆内存、DMA 缓冲区等',
      category: 'memory',
      templates: [
        'stdlib.android.android_dma_buffer_counts',
        'stdlib.android.android_dma_buffer_by_process',
        'stdlib.android.garbage_collection'
      ],
      order: 3
    },
    {
      id: 'cpu_analysis',
      name: 'CPU 分析',
      description: '分析 CPU 使用情况，包括调度、频率、各核心负载',
      category: 'cpu',
      templates: [
        'stdlib.sched.thread_executing_span_with_state',
        'stdlib.sched.runnable_thread_count'
      ],
      order: 4
    },
    {
      id: 'binder_analysis',
      name: 'Binder 通信分析',
      description: '分析 Binder IPC 调用，检测慢调用和阻塞',
      category: 'binder',
      templates: [
        'stdlib.android.android_binder_metrics_by_process',
        'stdlib.android.android_sync_binder_thread_state_by_txn',
        'stdlib.android.android_sync_binder_blocked_functions_by_txn',
        'stdlib.android.android_binder_graph'
      ],
      order: 5
    },
    {
      id: 'battery_analysis',
      name: '电池功耗分析',
      description: '分析电池状态、功耗轨迹',
      category: 'battery',
      templates: [
        'stdlib.android.charging_states',
        'stdlib.android.android_battery_charge',
        'stdlib.android.android_battery_stats_state'
      ],
      order: 6
    },
    {
      id: 'gpu_analysis',
      name: 'GPU 分析',
      description: '分析 GPU 频率、内存使用、工作周期',
      category: 'gpu',
      templates: [
        'stdlib.android.gpu.android_gpu_frequency_slice',
        'stdlib.android.gpu.android_gpu_memory_per_process'
      ],
      order: 7
    },
    {
      id: 'io_analysis',
      name: 'I/O 分析',
      description: '分析文件 I/O 操作',
      category: 'io',
      templates: [
        'stdlib.linux.io_uring_io'
      ],
      order: 8
    }
  ];

  // 验证模板是否存在
  const templateIds = new Set(templates.map(t => t.id));
  for (const scenario of scenarios) {
    scenario.templates = scenario.templates.filter(t => {
      const exists = templateIds.has(t);
      if (!exists) {
        console.warn(`Template not found for scenario ${scenario.id}: ${t}`);
      }
      return exists;
    });
  }

  return scenarios;
}

/**
 * 生成分类统计
 */
function generateCategoryStats(templates: PerfettoSqlTemplate[]) {
  const stats: Record<string, { count: number; types: Record<string, number> }> = {};

  for (const t of templates) {
    if (!stats[t.category]) {
      stats[t.category] = { count: 0, types: {} };
    }
    stats[t.category].count++;
    stats[t.category].types[t.type] = (stats[t.category].types[t.type] || 0) + 1;
  }

  return stats;
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 开始扫描 Perfetto SQL 文件...\n');

  // 扫描 stdlib
  console.log('📂 扫描 stdlib 目录...');
  const stdlibTemplates = scanDirectory(STDLIB_PATH, STDLIB_PATH);
  console.log(`   找到 ${stdlibTemplates.length} 个模板\n`);

  // 扫描 metrics
  console.log('📂 扫描 metrics 目录...');
  const metricsTemplates = scanDirectory(METRICS_PATH, METRICS_PATH);
  console.log(`   找到 ${metricsTemplates.length} 个模板\n`);

  // 合并所有模板
  const allTemplates = [...stdlibTemplates, ...metricsTemplates];

  // 生成分析场景
  const scenarios = generateAnalysisScenarios(allTemplates);

  // 生成统计
  const stats = generateCategoryStats(allTemplates);

  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 写入完整索引
  const indexPath = path.join(OUTPUT_DIR, 'perfettoSqlIndex.json');
  fs.writeFileSync(indexPath, JSON.stringify({
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    stats: {
      totalTemplates: allTemplates.length,
      byCategory: stats
    },
    templates: allTemplates,
    scenarios
  }, null, 2));
  console.log(`✅ 完整索引已写入: ${indexPath}`);

  // 写入精简索引（用于快速加载）
  const lightIndex = allTemplates.map(t => ({
    id: t.id,
    name: t.name,
    category: t.category,
    type: t.type,
    description: t.description.substring(0, 200)
  }));

  const lightIndexPath = path.join(OUTPUT_DIR, 'perfettoSqlIndex.light.json');
  fs.writeFileSync(lightIndexPath, JSON.stringify({
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    templates: lightIndex,
    scenarios
  }, null, 2));
  console.log(`✅ 精简索引已写入: ${lightIndexPath}`);

  // 打印统计
  console.log('\n📊 统计信息:');
  console.log(`   总模板数: ${allTemplates.length}`);
  console.log('   按分类:');
  for (const [cat, data] of Object.entries(stats)) {
    console.log(`     - ${cat}: ${data.count} (${Object.entries(data.types).map(([t, c]) => `${t}:${c}`).join(', ')})`);
  }

  console.log('\n🎯 分析场景:');
  for (const s of scenarios) {
    console.log(`   ${s.order}. ${s.name} (${s.templates.length} 个模板)`);
  }
}

main().catch(console.error);
