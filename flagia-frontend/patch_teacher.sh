sed -i '' 's|<div class="max-w-7xl mx-auto px-6 py-8">|<div class="w-full max-w-7xl mx-auto px-6 py-8">|g' src/views/TeacherDashboard.vue
sed -i '' 's|@click.self="showDetailModal = false"||g' src/views/TeacherDashboard.vue
sed -i '' 's|@click.self="showCreateModal = false"||g' src/views/TeacherDashboard.vue
sed -i '' 's|@click.self="showDeleteModal = false"||g' src/views/TeacherDashboard.vue

cat << 'INNER_EOF' > temp_replace.py
import sys

with open('src/views/TeacherDashboard.vue', 'r') as f:
    content = f.read()

target = """          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label">글자 수 제한</label>
              <input v-model.number="form.textLimit" type="number" class="input" min="100" max="50000" />
            </div>
            <div>
              <label class="label">분석 모드</label>
              <select v-model="form.mode" class="input">
                <option value="STRICT">엄격 모드</option>
                <option value="STANDARD">표준 모드</option>
                <option value="RESEARCH">연구 모드</option>
                <option value="CREATIVE">자유 모드</option>
              </select>
            </div>
          </div>"""

replacement = """          <div>
            <label class="label">글자 수 제한</label>
            <input v-model.number="form.textLimit" type="number" class="input" min="100" max="50000" />
          </div>

          <div>
            <label class="label">분석 모드</label>
            <div class="grid grid-cols-2 gap-3 mt-1">
              <div @click="form.mode = 'STRICT'" class="mode-option" :class="{ selected: form.mode === 'STRICT' }">
                <div class="font-bold text-primary mb-1">엄격 (Strict)</div>
                <div class="text-xs text-text-secondary leading-relaxed">모든 탭 이탈 및 복사-붙여넣기를 엄격하게 감지합니다. 시험이나 평가에 적합합니다.</div>
              </div>
              <div @click="form.mode = 'STANDARD'" class="mode-option" :class="{ selected: form.mode === 'STANDARD' }">
                <div class="font-bold text-primary mb-1">표준 (Standard)</div>
                <div class="text-xs text-text-secondary leading-relaxed">일반적인 글쓰기 환경. 잦은 탭 이탈이나 비정상적인 패턴에만 경고합니다.</div>
              </div>
              <div @click="form.mode = 'RESEARCH'" class="mode-option" :class="{ selected: form.mode === 'RESEARCH' }">
                <div class="font-bold text-primary mb-1">연구 (Research)</div>
                <div class="text-xs text-text-secondary leading-relaxed">자료 조사를 위한 탭 이동과 외부 텍스트 참조를 허용합니다.</div>
              </div>
              <div @click="form.mode = 'CREATIVE'" class="mode-option" :class="{ selected: form.mode === 'CREATIVE' }">
                <div class="font-bold text-primary mb-1">자유 (Creative)</div>
                <div class="text-xs text-text-secondary leading-relaxed">행동을 전혀 제한하지 않고 기본적인 타이핑 패턴만 수집합니다.</div>
              </div>
            </div>
          </div>"""

content = content.replace(target, replacement)

with open('src/views/TeacherDashboard.vue', 'w') as f:
    f.write(content)
INNER_EOF
python3 temp_replace.py
rm temp_replace.py
