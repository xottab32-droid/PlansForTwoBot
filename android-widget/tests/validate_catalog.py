"""Validate all nine launchable Android widget sizes and nonempty picker previews."""
from pathlib import Path
from xml.etree import ElementTree as ET

root = Path(__file__).resolve().parents[1] / "app" / "src" / "main"
a = "{http://schemas.android.com/apk/res/android}"
manifest = ET.parse(root / "AndroidManifest.xml").getroot()
receivers = manifest.findall("./application/receiver")
expected = {"1x2", "1x3", "1x4", "2x2", "2x3", "2x4", "3x3", "3x4", "4x4"}
found = set()
for receiver in receivers:
    metadata = receiver.find("meta-data")
    if metadata is None:
        continue
    resource = metadata.get(a+"resource", "")
    prefix = "@xml/widget_"
    if not resource.startswith(prefix) or not resource.endswith("_info"):
        continue
    size = resource[len(prefix):-len("_info")]
    assert size in expected, (size, "unknown picker entry")
    assert size not in found, (size, "duplicate picker entry")
    found.add(size)
    info_file = root / "res/xml" / (resource.split("/")[-1] + ".xml")
    info = ET.parse(info_file).getroot()
    height, width = map(int, size.split("x"))
    assert int(info.get(a+"targetCellWidth")) == width, size
    assert int(info.get(a+"targetCellHeight")) == height, size
    layout_ref = info.get(a+"initialLayout", "")
    assert (root / "res/layout" / (layout_ref.split("/")[-1] + ".xml")).exists(), size
    preview_ref = info.get(a+"previewLayout", "")
    assert preview_ref.startswith("@layout/preview_"), size
    preview_xml = root / "res/layout" / (preview_ref.split("/")[-1] + ".xml")
    preview = ET.parse(preview_xml).getroot()
    labels = [node.get(a+"text") for node in preview.iter() if node.tag == "TextView"]
    assert len(labels) >= 2 and any("дней" in (label or "") for label in labels), size
assert found == expected, (found, expected)
print("OK: 9 distinct widgets, correct grid sizes, nonempty previews")

# Regression: pinning must not send a custom bitmap RemoteViews to One UI.
java=root/"java"/"ru"/"plansfortwo"/"widget"
activity=(java/"MainActivity.java").read_text(encoding="utf-8")
widget=(java/"CoupleWidget.java").read_text(encoding="utf-8")
pin_code=activity.split("private void pinSelectedWidget()",1)[1].split("private void redrawPreview()",1)[0]
assert "new ComponentName(this,size.provider)" in pin_code
assert "requestPinAppWidget(provider,null,callback)" in pin_code
assert "extras.putParcelable" not in pin_code
assert "ACTION_PIN_SUCCEEDED" in pin_code
assert "ACTION_PIN_SUCCEEDED.equals(intent.getAction())" in widget
assert "AppWidgetManager.EXTRA_APPWIDGET_ID" in widget
assert "render(context,manager,widgetId)" in widget
print("OK: safe pinning with size-specific provider and confirmed render")

# Ensure every initial layout has visible content before One UI performs its first update.
layout_names = {"widget_1","widget_row2","widget_row3","widget_vert2","widget_vert3","widget_big"}
for layout_name in layout_names:
    layout = ET.parse(root / "res/layout" / (layout_name+".xml")).getroot()
    background = [n for n in layout.iter() if n.get(a+"id") == "@+id/bg"]
    loading = [n for n in layout.iter() if n.get(a+"id") == "@+id/loading"]
    assert len(background) == 1 and background[0].get(a+"src") == "@drawable/widget_loading_background", layout_name
    assert len(loading) == 1 and loading[0].get(a+"text"), layout_name
assert (root / "res/drawable/widget_loading_background.xml").is_file()
java = root / "java/ru/plansfortwo/widget"
provider = (java / "CoupleWidget.java").read_text(encoding="utf-8")
sync = (java / "WidgetSyncJob.java").read_text(encoding="utf-8")
catalog = (java / "WidgetCatalog.java").read_text(encoding="utf-8")
assert "setViewVisibility(R.id.loading,View.GONE)" in provider
assert "setViewVisibility(R.id.loading,android.view.View.GONE)" in catalog
assert "scheduleInitialRefresh(context)" in provider
assert "scheduleInitialRefresh(c)" in provider
assert "params.getJobId()==INITIAL_JOB_ID" in sync
assert "CoupleWidget.redrawAll(getApplicationContext())" in sync
print("OK: first-layout fallback and one-shot redraw retry for One UI")
