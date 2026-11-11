# Super Label feedback

Prepared source for the tier-one speed work. `drawingsWorkspace.applySuperLabel`
appears 87 times in the seven-day procedure inventory, which may include QA.
Its output requires recognition, so this action cannot preview a completed label.

The dialog now distinguishes saving boxes, reading the current named sheet,
and refreshing saved labels. Each phase appears before awaiting its request.
Stop acknowledges the click immediately, allows the in-flight read to complete,
and starts no further reads. Repeated activation cannot start a second run.
Returned labels and per-sheet failures remain visible; pending work never supplies
a guessed title or number. Model selection and the recognition service are unchanged.

The two mutations send once and never pause for reconnect. Starting offline is
refused, and losing connectivity stops the next read. The notice asks for a
refresh because a lost response cannot prove whether the server saved a label.
No automatic replay or second offline queue is introduced.

Seven deferred-response tests pass for phase feedback, stop, duplicate activation,
save/read failure, and connection loss. This is pending feedback for remote work, not completion
of an optimistic-write gate or proof of model accuracy or physical frame timing.
