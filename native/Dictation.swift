import Foundation
import AVFoundation
import Speech

// JSON lines on stdout; only an explicit start command requests permissions.
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data + Data([10]))
    }
}

let locale = CommandLine.arguments.dropFirst().first ?? "en-US"
let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
if CommandLine.arguments.contains("--status") {
    emit(["available": recognizer?.isAvailable ?? false,
          "onDevice": recognizer?.supportsOnDeviceRecognition ?? false,
          "authorization": SFSpeechRecognizer.authorizationStatus().rawValue])
    exit(0)
}

let engine = AVAudioEngine()
var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?
var text = ""
var finished = false
var stopping = false
var tapped = false

func stopAudio() {
    engine.stop()
    if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
    request?.endAudio()
}
func finish(_ error: String? = nil, cancelled: Bool = false) {
    guard !finished else { return }
    finished = true
    stopAudio()
    task?.cancel()
    if let error = error { emit(["type": "error", "message": error, "text": text]) }
    else { emit(["type": cancelled ? "cancelled" : "final", "text": cancelled ? "" : text]) }
    exit(0)
}
func stop() {
    guard !finished && !stopping else { return }
    stopping = true
    stopAudio()
    if task == nil { finish(); return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish() }
}
func start() {
    guard !finished && !stopping else { return }
    guard let recognizer = recognizer, recognizer.isAvailable else {
        finish("Speech recognition is unavailable for this language. Choose another language or check macOS Dictation settings."); return
    }
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0 && format.channelCount > 0 else {
        finish("No microphone is available. Check your sound input in System Settings."); return
    }
    let audio = SFSpeechAudioBufferRecognitionRequest()
    audio.shouldReportPartialResults = true
    audio.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
    audio.taskHint = .dictation
    if #available(macOS 13, *) { audio.addsPunctuation = true }
    request = audio
    task = recognizer.recognitionTask(with: audio) { result, error in
        DispatchQueue.main.async {
            guard !finished else { return }
            if let result = result {
                text = result.bestTranscription.formattedString
                emit(["type": "partial", "text": text])
                if result.isFinal { finish(); return }
            }
            if error != nil {
                if stopping && !text.isEmpty { finish() }
                else { finish("Speech recognition stopped. Your captured text is kept below. Check the selected language and microphone, then try again.") }
            }
        }
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in audio.append(buffer) }
    tapped = true
    do {
        engine.prepare()
        try engine.start()
        emit(["type": "listening"])
        // Short dictation sessions fit Apple's speech-recognition task limits.
        DispatchQueue.main.asyncAfter(deadline: .now() + 55) { stop() }
    } catch { finish("Could not start the microphone. Check your sound input and try again.") }
}

DispatchQueue.global().async {
    while let line = readLine() {
        DispatchQueue.main.async {
            if line == "stop" { stop() }
            else if line == "cancel" { finish(cancelled: true) }
        }
    }
    DispatchQueue.main.async { finish(cancelled: true) }
}
SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        guard !finished && !stopping else { return }
        guard status == .authorized else {
            finish("Allow Speech Recognition for Research Workbench in System Settings > Privacy & Security, then restart the app."); return
        }
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            DispatchQueue.main.async {
                if allowed { start() }
                else { finish("Allow Microphone access for Research Workbench in System Settings > Privacy & Security, then restart the app.") }
            }
        }
    }
}
RunLoop.main.run()
