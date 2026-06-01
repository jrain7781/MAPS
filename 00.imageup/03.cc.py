# -*- coding: utf-8 -*-
"""
호환 shim — 진행사항 확인 스크립트는 04.cc.py 로 이름이 바뀜.
매니저 서버를 재시작하지 않아 옛 경로(03.cc.py)로 실행돼도 04.cc.py 가 돌도록 위임.
(서버 재시작 후에는 mj_extensions 가 04.cc.py 를 직접 호출하므로 이 파일은 안 쓰임)
"""
import os
import runpy

_target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "04.cc.py")
runpy.run_path(_target, run_name="__main__")
