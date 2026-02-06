

/***** Read 조회 *****/
async function fetchFarms() {
    const tbody = document.getElementById('farm-tbody');
    tbody.innerHTML = '<tr><td colspan="14">로딩 중...</td></tr>';

    try {
    const res = await fetch(apiBase);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const data = await res.json();
    // 서버가 배열을 직접 반환하거나 { farms: [...] } 형태를 반환할 수 있으므로 모두 처리
    const farms = Array.isArray(data) ? data : (data.farms || []);
    tbody.innerHTML = '';

    if (farms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14">등록된 농장이 없습니다.</td></tr>';
        return;
    }

    farms.forEach(farm => {
        const tr = document.createElement('tr');
        // 가능한 키들 중 하나를 사용하여 id 설정 (서버 응답에 따라 필드명이 다를 수 있음)
        const farmId = farm.농장ID ?? farm.id ?? farm.farmId ?? '';
        tr.dataset.id = farmId;

        // 농장ID (읽기 전용)
        let td = document.createElement('td');
        let input = document.createElement('input');
        input.type = 'number';
        input.value = farmId;
        input.readOnly = true;
        input.className = 'readonly';
        td.appendChild(input);
        tr.appendChild(td);

        // 농장명
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'text';
        input.value = farm.농장명 ?? farm.name ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 지역
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'text';
        input.value = farm.지역 ?? farm.region ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 뱃지
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'text';
        input.value = farm.뱃지 ?? farm.badge ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 농장주ID
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'number';
        input.value = farm.농장주ID ?? farm.ownerId ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 농장주
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'text';
        input.value = farm.농장주 ?? farm.owner ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 사료회사
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'text';
        input.value = farm.사료회사 ?? farm.feedCompany ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 관리자ID
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'number';
        input.value = farm.관리자ID ?? farm.managerId ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 관리자
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'text';
        input.value = farm.관리자 ?? farm.manager ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 계약상태
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'text';
        input.value = farm.계약상태 ?? farm.contractStatus ?? '';
        td.appendChild(input);
        tr.appendChild(td);

        // 계약시작일
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'date';
        input.value = toDateInputValue(farm.계약시작일 ?? farm.contractStart ?? '');
        td.appendChild(input);
        tr.appendChild(td);

        // 계약종료일
        td = document.createElement('td');
        input = document.createElement('input');
        input.type = 'date';
        input.value = toDateInputValue(farm.계약종료일 ?? farm.contractEnd ?? '');
        td.appendChild(input);
        tr.appendChild(td);

        // 수정 버튼
        td = document.createElement('td');
        const editBtn = document.createElement('button');
        editBtn.textContent = '수정';
        editBtn.className = 'edit-btn';   // 수정 버튼 전용 클래스 추가
        editBtn.addEventListener('click', () => updateFarm(tr));
        td.appendChild(editBtn);
        tr.appendChild(td);

        // 삭제 버튼
        td = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.textContent = '삭제';
        delBtn.className = 'delete-btn';  // 삭제 버튼 전용 클래스
        delBtn.addEventListener('click', () => deleteFarm(farmId));
        td.appendChild(delBtn);
        tr.appendChild(td);

        tbody.appendChild(tr);
    });
    } catch (error) {
    tbody.innerHTML = '';
    console.error('fetchFarms 오류:', error);
    showErrorPopup('농장 정보를 불러오는데 실패했습니다: ' + (error.message || error));
    }
}

/***** Create 등록 *****/
async function addFarm() {
    const farm = {
    농장명: document.getElementById('new-농장명').value.trim(),
    지역: document.getElementById('new-지역').value.trim(),
    뱃지: document.getElementById('new-뱃지').value.trim(),
    농장주ID: parseInt(document.getElementById('new-농장주ID').value) || null,
    농장주: document.getElementById('new-농장주').value.trim(),
    사료회사: document.getElementById('new-사료회사').value.trim(),
    관리자ID: parseInt(document.getElementById('new-관리자ID').value) || null,
    관리자: document.getElementById('new-관리자').value.trim(),
    계약상태: document.getElementById('new-계약상태').value.trim(),
    계약시작일: document.getElementById('new-계약시작일').value || null,
    계약종료일: document.getElementById('new-계약종료일').value || null,
    };

    try {
    const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(farm),
    });

    if (res.ok) {
        // 성공팝업
        showSuccessPopup();
        clearNewFarmInputs();
        fetchFarms();
    } else {
        const text = await res.text();
        console.error('추가 실패 응답:', res.status, text);
        showErrorPopup('추가 실패: ' + res.status);
    }
    } catch (error) {
    console.error('addFarm 오류:', error);
    showErrorPopup('추가 중 오류 발생: ' + (error.message || error));
    }
}

/***** Create 보조 *****/
function clearNewFarmInputs() {
    document.querySelectorAll('#new-farm-row input').forEach(i => i.value = '');
}

/***** Update 수정 *****/
async function updateFarm(tr) {
    const inputs = tr.querySelectorAll('input');
    const id = tr.dataset.id;
    if (!id) {
    showErrorPopup('유효한 농장ID가 없습니다.');
    return;
    }

    // inputs 순서: 0:ID(readonly), 1:농장명, 2:지역, 3:뱃지, 4:농장주ID, 5:농장주,
    // 6:사료회사, 7:관리자ID, 8:관리자, 9:계약상태, 10:계약시작일, 11:계약종료일
    const farm = {
    농장명: inputs[1].value.trim(),
    지역: inputs[2].value.trim(),
    뱃지: inputs[3].value.trim(),
    농장주ID: parseInt(inputs[4].value) || null,
    농장주: inputs[5].value.trim(),
    사료회사: inputs[6].value.trim(),
    관리자ID: parseInt(inputs[7].value) || null,
    관리자: inputs[8].value.trim(),
    계약상태: inputs[9].value.trim(),
    계약시작일: inputs[10].value || null,
    계약종료일: inputs[11].value || null,
    };

    try {
    const res = await fetch(`${apiBase}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(farm),
    });

    if (res.ok) {
        // 성공
        showSuccessPopup();
        fetchFarms();
    } else {
        const text = await res.text();
        console.error('수정 실패 응답:', res.status, text);
        showErrorPopup('수정 실패: ' + res.status);
    }
    } catch (error) {
    console.error('updateFarm 오류:', error);
    showErrorPopup('수정 중 오류 발생: ' + (error.message || error));
    }
}

/***** Delete 삭제 *****/
async function deleteFarm(id) {
  if (!id) {
    showErrorPopup('유효한 농장ID가 없습니다.');
    return;
  }
  const confirmed = await showConfirmPopup('삭제하시겠습니까?');
  if (!confirmed) return;

  try {
    const res = await fetch(`${apiBase}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      showSuccessPopup();
      fetchFarms();
    } else {
      const text = await res.text();
      console.error('삭제 실패 응답:', res.status, text);
      showErrorPopup('삭제 실패: ' + res.status);
    }
  } catch (error) {
    console.error('deleteFarm 오류:', error);
    showErrorPopup('삭제 중 오류 발생: ' + (error.message || error));
  }
}

// 이벤트 바인딩 - Create 버튼 연결 (페이지에 요소가 있는 경우에만)
const addBtn = document.querySelector('.add-btn');
if (addBtn) addBtn.addEventListener('click', addFarm);

// 초기 데이터 로드 (DOM 준비 후) — farms 테이블이 있는 페이지에만 호출
window.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('farm-tbody')) {
    fetchFarms();
  }
});
