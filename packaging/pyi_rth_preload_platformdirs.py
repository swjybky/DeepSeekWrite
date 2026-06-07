"""在 pkg_resources 被间接导入前预加载 platformdirs（PyInstaller 冻结环境）。"""


def _pyi_rthook() -> None:
    try:
        import platformdirs  # noqa: F401
    except Exception:
        pass


_pyi_rthook()
del _pyi_rthook
