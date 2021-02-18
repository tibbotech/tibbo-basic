# The Tibbo Basic Programming Language

Tibbo BASIC is a version of the classic BASIC languages that have been around for decades. BASIC spawned hundreds of variants, and no standards exist (or are remembered) that document its features.

Tibbo BASIC applications are event-driven — all code is executed in event handlers, which are invoked in response to events. This is known as event-based execution.

Tibbo BASIC uses the static memory model: all RAM is allocated at compile time, and there is no heap. This means that there will be no "out of memory" situations — ever. There is no need for garbage collection, nor is there associated overhead. However, this also means that there is no dynamic sizing of memory structures, no dynamic object creation and destruction, and no recursion or reentrant calls.

Tibbo BASIC is "pure" in that it contains no I/O facilities of any kind (no PRINT, INPUT, etc.). Instead, all I/O is handled by objects.

To create a new project, use [CODY](https://cody.tibbo.com), our project configuration and code generation tool.

More information on Tibbo BASIC is available [here](https://docs.tibbo.com/taiko/lang).

For more information about our IoT ecosystem, click [here](https://tibbo.com).

![Screenshot](images/screenshot.jpg)