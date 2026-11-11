# Development speed overlay

Run the development app and append `?speed=1` (or `&speed=1`) to its URL.
The overlay shows the latest tap/write marks and a rolling window of up to 180
visible animation-frame intervals. It stops sampling while hidden or closed.
It makes no network requests and stores no data.

The import is behind a compile-time development condition. Production builds
must not include this overlay; verify that when preparing the next canonical
build. The baseline application is unchanged.

Tap and write values are the existing double-animation-frame paint-opportunity
marks, not direct presentation timestamps. The refresh interval uses the tenth
percentile of at least 30 positive frame gaps. Missed slots are an estimate from
those gaps, not a count of actual dropped compositor frames. Development
instrumentation itself costs time. These readings do not replace the isolated
lab, physical-phone frame traces, or field gates.

All three estimator, lifecycle and hidden-observer tests pass. Production exclusion still needs the
next canonical build check. This is the development aid from speed-plan section 13.
