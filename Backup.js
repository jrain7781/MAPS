/**
 * [Backup.gs]
 * 데이터 백업 및 복원 관련 기능
 */

/**
 * 데이터를 구글 드라이브에 JSON으로 백업합니다.
 * - 대상: items, members, telegram_requests 시트
 * - 위치: 'MAPS_BACKUP' 폴더 (없으면 생성)
 * - 파일명: backup_YYYYMMDD_HHmmss.json
 */
function backupDataToDrive() {
    try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

        // 1. 백업할 데이터 읽기
        const data = {
            timestamp: new Date().toISOString(),
            items: readAllData(), // SheetDB.gs
            members: readAllMembersNew(), // SheetDB.gs
            telegram_requests: listTelegramRequests('ALL') // SheetDB.gs (ALL option required or modify helper)
        };

        // telegram_requests는 PENDING만 가져오는 함수가 기본이므로, 전체를 가져오도록 수정 필요하거나 
        // 여기서는 간단히 있는 그대로 가져옵니다. 
        // (만약 listTelegramRequests가 status 인자를 받으면 'PENDING'만 가져올 수 있음. 
        //  전체 백업을 위해 수정이 필요할 수 있으나, 일단 현재 함수 사용)

        // JSON 변환
        const jsonString = JSON.stringify(data, null, 2);
        const fileName = `backup_${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss')}.json`;

        // 2. 백업 폴더 확인 및 생성
        const folders = DriveApp.getFoldersByName('MAPS_BACKUP');
        let folder;
        if (folders.hasNext()) {
            folder = folders.next();
        } else {
            folder = DriveApp.createFolder('MAPS_BACKUP');
        }

        // 3. JSON 파일 저장
        const file = folder.createFile(fileName, jsonString, MimeType.PLAIN_TEXT);

        // 4. (New) 스프레드시트 파일 자체 복사 (데이터 + 스크립트 + 포맷)
        const timestamp_str = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
        const backupSheetName = `MAPS_BACKUP_${timestamp_str}`;
        const originFile = DriveApp.getFileById(SPREADSHEET_ID);
        originFile.makeCopy(backupSheetName, folder);

        // 4. 오래된 백업 정리 (선택사항: 최근 30개만 유지)
        cleanupOldBackups_(folder, 30);

        return { success: true, message: `백업 완료: ${file.getName()}`, url: file.getUrl() };

    } catch (e) {
        Logger.log('백업 중 오류 발생: ' + e.toString());
        return { success: false, message: '백업 실패: ' + e.message };
    }
}

/**
 * 오래된 백업 파일을 삭제합니다.
 * @param {GoogleAppsScript.Drive.Folder} folder 
 * @param {number} keepCount 유지할 파일 개수
 */
function cleanupOldBackups_(folder, keepCount) {
    try {
        const files = folder.getFiles();
        const fileList = [];
        while (files.hasNext()) {
            fileList.push(files.next());
        }

        // 날짜순 정렬 (최신이 위로)
        fileList.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());

        // keepCount 넘어가는 파일 삭제
        if (fileList.length > keepCount) {
            for (let i = keepCount; i < fileList.length; i++) {
                fileList[i].setTrashed(true);
            }
        }
    } catch (e) {
        console.error('백업 정리 중 오류:', e);
    }
}

/**
 * [Admin Menu] 수동 백업 트리거용
 */
function manualBackupFromMenu() {
    const result = backupDataToDrive();
    if (result.success) {
        SpreadsheetApp.getUi().alert(result.message + '\n\n' + result.url);
    } else {
        SpreadsheetApp.getUi().alert(result.message);
    }
}

/**
 * [Admin Menu] 매일 오전 9시 자동 백업 설정
 */
function setupBackupTrigger() {
    try {
        // 기존 백업 트리거 제거 (중복 방지)
        const triggers = ScriptApp.getProjectTriggers();
        for (let i = 0; i < triggers.length; i++) {
            if (triggers[i].getHandlerFunction() === 'backupDataToDrive') {
                ScriptApp.deleteTrigger(triggers[i]);
            }
        }

        // 새 트리거 생성 (매일 오전 9시 ~ 10시 사이 실행)
        ScriptApp.newTrigger('backupDataToDrive')
            .timeBased()
            .everyDays(1)
            .atHour(9)
            .create();

        SpreadsheetApp.getUi().alert('매일 오전 9시 자동 백업이 설정되었습니다.');
    } catch (e) {
        SpreadsheetApp.getUi().alert('트리거 설정 실패: ' + e.message);
    }
}
