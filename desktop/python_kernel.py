import ast
import base64
import contextlib
import io
import json
import os
import shlex
import subprocess
import sys
import traceback
import types


ROOT = os.path.abspath(os.environ["MANNEUNG_KERNEL_ROOT"])
CWD = os.path.abspath(os.getcwd())        # 실행 작업폴더(= 연 노트북의 폴더). __file__ 기준으로 삼는다.
_path = CWD
_import_paths = []
while _path:
    _import_paths.append(_path)
    if os.path.normcase(_path) == os.path.normcase(ROOT):
        break
    _parent = os.path.dirname(_path)
    if _parent == _path:
        break
    _path = _parent
for _path in reversed(_import_paths):
    if _path not in sys.path:
        sys.path.insert(0, _path)
# 이 커널은 주피터 노트북처럼 대화형이다. python-dotenv 의 find_dotenv() 등은 __main__ 에 __file__ 이
# 없으면(=노트북) 작업폴더(CWD)를 기준으로 .env 를 찾는다. 러너가 __main__ 이라 __file__ 이 붙어 있어
# 스크립트로 오인되므로, 이를 제거해 CWD(=연 노트북 폴더)의 .env 를 그대로 찾게 한다.
try:
    del sys.modules["__main__"].__file__
except Exception:
    pass
NAMESPACE = {
    "__name__": "__main__",
    # 셀 코드가 직접 __file__ 을 쓸 때(경로 계산 등) 작업폴더 기준이 되도록 CWD 안의 가상 경로로 둔다.
    "__file__": os.path.join(CWD, "__manneung_notebook__.py"),
}
ACTIVE_RICH_OUTPUTS = None
MAX_TEXT = 4 * 1024 * 1024
MAX_RICH = 5 * 1024 * 1024
MAX_RICH_BINARY = 3 * 1024 * 1024
MAX_FILE = 20 * 1024 * 1024
MAX_FILES = 200
RICH_MIME_KEYS = {
    "text/html",
    "text/plain",
    "text/latex",
    "image/svg+xml",
    "image/png",
    "image/jpeg",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/ogg",
    "audio/webm",
    "video/mp4",
    "video/webm",
    "video/ogg",
    "application/json",
    "application/javascript",
}


class LimitedText(io.TextIOBase):
    def __init__(self, limit=MAX_TEXT):
        self.limit = limit
        self.parts = []
        self.length = 0
        self.truncated = False

    def writable(self):
        return True

    def write(self, value):
        text = str(value)
        remaining = self.limit - self.length
        if remaining > 0:
            kept = text[:remaining]
            self.parts.append(kept)
            self.length += len(kept)
        if len(text) > max(0, remaining):
            self.truncated = True
        return len(text)

    def flush(self):
        return None

    def getvalue(self):
        text = "".join(self.parts)
        if self.truncated:
            text += "\n\n[출력이 4MB를 넘어 이후 내용은 생략했습니다. 실행은 계속됩니다.]\n"
        return text


def safe_repr(value, limit=600):
    try:
        text = repr(value)
    except BaseException:
        text = "<값을 표시할 수 없음>"
    if len(text) > limit:
        text = text[: max(0, limit - 1)] + "…"
    return text


def variable_rows():
    rows = []
    for name in sorted(NAMESPACE):
        if not name or name.startswith("_") or name == "get_ipython":
            continue
        value = NAMESPACE[name]
        if isinstance(
            value,
            (
                types.ModuleType,
                types.FunctionType,
                types.BuiltinFunctionType,
                type,
            ),
        ) or callable(value):
            continue
        row = {
            "name": name[:120],
            "type": type(value).__name__[:120],
            "value": safe_repr(value),
            "lazy": False,
        }
        shape = getattr(value, "shape", None)
        if shape is not None:
            row["shape"] = str(shape)[:40]
        rows.append(row)
        if len(rows) >= 80:
            break
    return rows


def _rich_json_default(value):
    to_list = getattr(value, "tolist", None)
    if callable(to_list):
        try:
            return to_list()
        except BaseException:
            pass
    iso_format = getattr(value, "isoformat", None)
    if callable(iso_format):
        try:
            return iso_format()
        except BaseException:
            pass
    return str(value)


def _rich_mime_allowed(mime):
    return (
        mime in RICH_MIME_KEYS
        or (mime.startswith("application/vnd.") and mime.endswith("+json"))
    )


def _rich_mime_value(mime, value):
    if value is None or not _rich_mime_allowed(mime):
        return None
    if isinstance(value, tuple):
        value = value[0] if value else None
    if value is None:
        return None
    if mime.startswith(("image/", "audio/", "video/")) and mime != "image/svg+xml":
        if isinstance(value, (bytes, bytearray, memoryview)):
            raw = bytes(value)
            if len(raw) > MAX_RICH_BINARY:
                return None
            return base64.b64encode(raw).decode("ascii")
        text = str(value)
        return text if len(text) <= MAX_RICH else None
    if mime == "application/json" or mime.endswith("+json"):
        try:
            encoded = json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
                default=_rich_json_default,
            )
            if len(encoded) > MAX_RICH:
                return None
            return json.loads(encoded)
        except BaseException:
            return None
    text = str(value)
    return text if len(text) <= MAX_RICH else None


def _rich_mime_data(value):
    data = {}
    bundle_method = getattr(value, "_repr_mimebundle_", None)
    if callable(bundle_method):
        try:
            try:
                bundle = bundle_method()
            except TypeError:
                bundle = bundle_method(include=None, exclude=None)
            if isinstance(bundle, tuple):
                bundle = bundle[0] if bundle else {}
            if isinstance(bundle, dict):
                for mime, raw in bundle.items():
                    mime = str(mime)
                    normalized = _rich_mime_value(mime, raw)
                    if normalized is not None:
                        data[mime] = normalized
        except BaseException:
            pass
    methods = (
        ("text/html", "_repr_html_"),
        ("image/svg+xml", "_repr_svg_"),
        ("image/png", "_repr_png_"),
        ("image/jpeg", "_repr_jpeg_"),
        ("text/latex", "_repr_latex_"),
        ("application/json", "_repr_json_"),
    )
    for mime, method_name in methods:
        if mime in data:
            continue
        method = getattr(value, method_name, None)
        if not callable(method):
            continue
        try:
            normalized = _rich_mime_value(mime, method())
            if normalized is not None:
                data[mime] = normalized
        except BaseException:
            pass
    bokeh_model = False
    bokeh_error = None
    try:
        import bokeh
        from bokeh.embed import json_item
        from bokeh.model import Model as BokehModel

        bokeh_model = isinstance(value, BokehModel)
        if bokeh_model:
            payload = {
                "item": json_item(value, "bokeh"),
                "version": str(bokeh.__version__),
            }
            normalized = _rich_mime_value(
                "application/vnd.bokehjs_exec.v0+json",
                payload,
            )
            if normalized is not None:
                data["application/vnd.bokehjs_exec.v0+json"] = normalized
    except BaseException as error:
        bokeh_error = type(error).__name__ + ": " + str(error)
    if bokeh_model and "application/vnd.bokehjs_exec.v0+json" not in data:
        try:
            from bokeh.embed import file_html
            from bokeh.resources import CDN

            html = file_html(value, CDN, "Bokeh chart")
            if len(html) <= MAX_RICH:
                data["text/html"] = html
        except BaseException as error:
            if bokeh_error is None:
                bokeh_error = type(error).__name__ + ": " + str(error)
    plain = safe_repr(value, MAX_RICH)
    if (
        bokeh_model
        and "application/vnd.bokehjs_exec.v0+json" not in data
        and "text/html" not in data
        and bokeh_error
    ):
        plain += "\n[Bokeh 출력 변환 오류] " + bokeh_error
    data.setdefault("text/plain", plain)
    return data


def rich_output(value):
    if value is None:
        return None
    return {
        "output_type": "execute_result",
        "data": _rich_mime_data(value),
        "metadata": {},
    }


def display(*values):
    if ACTIVE_RICH_OUTPUTS is None:
        return None
    for value in values:
        rendered = rich_output(value)
        if rendered:
            ACTIVE_RICH_OUTPUTS.append(rendered)
    return None


def capture_plots():
    images = []
    try:
        import matplotlib.pyplot as plt

        for number in list(plt.get_fignums())[:8]:
            figure = plt.figure(number)
            # plt.figure()만 호출되고 아무 축·도형·텍스트도 추가되지 않은 빈 캔버스는 결과에서 제외한다.
            # 픽셀 색으로 판별하지 않으므로 흰 배경이나 여백이 큰 정상 그래프는 그대로 보존된다.
            content_groups = ("axes", "artists", "lines", "images", "texts", "legends")
            if not any(getattr(figure, name, []) for name in content_groups):
                plt.close(figure)
                continue
            output = io.BytesIO()
            figure.savefig(output, format="png", bbox_inches="tight")
            raw = output.getvalue()
            if len(raw) <= 8 * 1024 * 1024:
                images.append("data:image/png;base64," + base64.b64encode(raw).decode("ascii"))
            plt.close(figure)
    except BaseException:
        pass
    return images


def file_snapshot():
    result = {}
    for current, dirs, files in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name != "__pycache__"]
        for name in files:
            full = os.path.join(current, name)
            try:
                stat = os.stat(full)
            except OSError:
                continue
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            result[rel] = (stat.st_size, stat.st_mtime_ns)
    return result


SNAPSHOT = file_snapshot()


def changed_outputs():
    global SNAPSHOT
    current = file_snapshot()
    rows = []
    for name in sorted(current):
        size, mtime = current[name]
        if SNAPSHOT.get(name) == (size, mtime):
            continue
        if size <= MAX_FILE:
            rows.append({"name": name, "size": size})
        if len(rows) >= MAX_FILES:
            break
    SNAPSHOT = current
    return rows


def run_shell(command):
    completed = subprocess.run(
        command,
        cwd=os.getcwd(),
        shell=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        errors="replace",
    )
    if completed.stdout:
        print(completed.stdout, end="" if completed.stdout.endswith("\n") else "\n")
    return completed.returncode


def run_line_magic(name, argument):
    magic = str(name or "").strip().lower()
    value = str(argument or "")
    if magic == "matplotlib":
        return None
    if magic == "pip":
        args = [sys.executable, "-m", "pip"] + shlex.split(value)
        completed = subprocess.run(
            args,
            cwd=os.getcwd(),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
            errors="replace",
        )
        if completed.stdout:
            print(completed.stdout, end="" if completed.stdout.endswith("\n") else "\n")
        if completed.returncode:
            raise RuntimeError("pip 명령이 종료 코드 %d로 끝났습니다." % completed.returncode)
        return None
    raise RuntimeError("지원하지 않는 IPython 매직 명령입니다: %" + magic)


class ManneungIPython:
    def system(self, command):
        return run_shell(command)

    def run_line_magic(self, name, argument):
        return run_line_magic(name, argument)


NAMESPACE["get_ipython"] = lambda: ManneungIPython()
NAMESPACE["display"] = display


def preprocess_magics(source):
    converted = []
    for line in str(source or "").splitlines():
        stripped = line.lstrip()
        indent = line[: len(line) - len(stripped)]
        if stripped.startswith("%pip "):
            converted.append(
                indent
                + "get_ipython().run_line_magic('pip', "
                + repr(stripped[5:])
                + ")"
            )
        elif stripped in ("%matplotlib", "%matplotlib inline", "%matplotlib notebook"):
            converted.append(indent + "get_ipython().run_line_magic('matplotlib', 'inline')")
        elif stripped.startswith("!"):
            converted.append(indent + "get_ipython().system(" + repr(stripped[1:]) + ")")
        else:
            converted.append(line)
    return "\n".join(converted)


def execute(request):
    global ACTIVE_RICH_OUTPUTS
    source = preprocess_magics(request.get("source", ""))
    stdin_text = str(request.get("stdin", ""))
    stdout = LimitedText()
    stderr = LimitedText()
    rich = []
    ACTIVE_RICH_OUTPUTS = rich
    ok = True
    old_stdin = sys.stdin
    try:
        sys.stdin = io.StringIO(stdin_text)
        tree = ast.parse(source, "<notebook-cell>", "exec")
        last_expression = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expression = ast.Expression(tree.body.pop().value)
            ast.fix_missing_locations(last_expression)
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            if tree.body:
                exec(compile(tree, "<notebook-cell>", "exec"), NAMESPACE, NAMESPACE)
            if last_expression is not None:
                value = eval(
                    compile(last_expression, "<notebook-cell>", "eval"),
                    NAMESPACE,
                    NAMESPACE,
                )
                rendered = rich_output(value)
                if rendered:
                    rich.append(rendered)
    except BaseException:
        ok = False
        traceback.print_exc(file=stderr)
    finally:
        sys.stdin = old_stdin
        ACTIVE_RICH_OUTPUTS = None
    return {
        "ok": ok,
        "code": 0 if ok else 1,
        "stdout": stdout.getvalue(),
        "stderr": stderr.getvalue(),
        "richOutputs": rich,
        "images": capture_plots(),
        "variables": variable_rows(),
        "outputs": changed_outputs(),
    }


def write_response(value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded = base64.b64encode(raw).decode("ascii")
    sys.__stdout__.write(encoded + "\n")
    sys.__stdout__.flush()


def main():
    for line in sys.__stdin__:
        try:
            raw = base64.b64decode(line.strip())
            request = json.loads(raw.decode("utf-8"))
            if request.get("action") == "exec":
                write_response(execute(request))
            else:
                write_response({"ok": False, "code": 1, "stderr": "알 수 없는 커널 명령입니다."})
        except BaseException:
            write_response(
                {
                    "ok": False,
                    "code": 1,
                    "stdout": "",
                    "stderr": traceback.format_exc(),
                    "richOutputs": [],
                    "images": [],
                    "variables": [],
                    "outputs": [],
                }
            )


if __name__ == "__main__":
    main()
