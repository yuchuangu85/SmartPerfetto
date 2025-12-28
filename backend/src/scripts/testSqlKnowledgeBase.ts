/**
 * 测试 SQL 知识库和增强模板引擎
 */

import { getExtendedKnowledgeBase } from '../services/sqlKnowledgeBase';
import { getEnhancedSQLTemplateEngine } from '../services/sqlTemplateEngine';

async function main() {
  console.log('🧪 测试 SQL 知识库和增强模板引擎\n');

  // 1. 测试知识库
  console.log('1️⃣ 初始化知识库...');
  const kb = await getExtendedKnowledgeBase();
  console.log('   ✅ 知识库初始化成功\n');

  // 2. 测试分类列表
  console.log('2️⃣ 获取分类列表:');
  const categories = kb.getIndexCategories();
  console.log(`   找到 ${categories.length} 个分类: ${categories.slice(0, 5).join(', ')}...\n`);

  // 3. 测试搜索
  console.log('3️⃣ 测试智能搜索:');
  const searchQueries = ['启动分析', 'frame jank', 'binder', 'memory'];
  for (const query of searchQueries) {
    const results = kb.smartMatch(query);
    console.log(`   "${query}" -> ${results.length} 个结果`);
    if (results.length > 0) {
      console.log(`      Top: ${results[0].template.name} (${results[0].template.type})`);
    }
  }
  console.log('');

  // 4. 测试场景
  console.log('4️⃣ 分析场景:');
  const scenarios = kb.getScenarios();
  for (const s of scenarios) {
    console.log(`   ${s.order}. ${s.name}: ${s.templates.length} 个模板`);
  }
  console.log('');

  // 5. 测试增强模板引擎
  console.log('5️⃣ 测试增强模板引擎...');
  const engine = await getEnhancedSQLTemplateEngine();
  const stats = await engine.getStats();
  console.log(`   内置模板: ${stats.builtinTemplates} 个`);
  console.log(`   官方模板: ${stats.officialTemplates} 个`);
  console.log(`   分类数量: ${stats.categories.length} 个\n`);

  // 6. 测试智能匹配
  console.log('6️⃣ 测试智能匹配:');
  const matchResult = await engine.smartMatchWithOfficial('应用启动分析');
  console.log(`   内置模板: ${matchResult.builtinTemplate?.name || '无'}`);
  console.log(`   官方模板: ${matchResult.officialTemplates.length} 个`);
  console.log(`   推荐SQL: ${matchResult.recommendedSQL.length} 个\n`);

  // 7. 测试 AI 上下文生成
  console.log('7️⃣ 测试 AI 上下文生成:');
  const context = await engine.getAIContext('分析应用启动时间');
  console.log('   生成的上下文:');
  console.log('   ' + context.split('\n').slice(0, 5).join('\n   '));
  console.log('   ...\n');

  // 8. 测试推荐 SQL
  console.log('8️⃣ 测试推荐 SQL:');
  const recommendedCategories = ['startup', 'frame', 'cpu', 'binder'];
  for (const cat of recommendedCategories) {
    const queries = await engine.getRecommendedSQL(cat);
    console.log(`   ${cat}: ${queries.length} 个推荐查询`);
    if (queries.length > 0) {
      console.log(`      - ${queries[0].name}`);
    }
  }
  console.log('');

  console.log('✅ 所有测试完成!');
}

main().catch(console.error);
