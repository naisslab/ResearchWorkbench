import Foundation
import AVFoundation
import Speech

// JSON lines on stdout, written in order from any thread.
let output = DispatchQueue(label: "dictation.output")
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    output.async { FileHandle.standardOutput.write(data + Data([10])) }
}

/// One on-device recognizer per language. Every recognizer hears the same
/// audio; the one most confident in what it has finalized is shown.
final class Candidate {
    let locale: Locale
    let transcriber: DictationTranscriber
    let analyzer: SpeechAnalyzer
    let input: AsyncStream<AnalyzerInput>.Continuation
    let stream: AsyncStream<AnalyzerInput>
    var finalized = ""
    var volatile = ""
    var confidence = 0.0
    var weight = 0.0
    var results: Task<Void, Never>?
    init(_ locale: Locale, _ transcriber: DictationTranscriber) {
        self.locale = locale
        self.transcriber = transcriber
        analyzer = SpeechAnalyzer(modules: [transcriber])
        (stream, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
    }
    var text: String { joined(finalized, volatile) }
    var score: Double { weight > 0 ? confidence / weight : 0 }
    var name: String {
        Locale.current.localizedString(forIdentifier: locale.identifier) ?? locale.identifier
    }
}

// Words in Latin scripts need a space between finalized phrases; Chinese and
// Japanese text does not.
func joined(_ a: String, _ b: String) -> String {
    guard let last = a.last, let first = b.first else { return a + b }
    let ideographic = { (c: Character) in
        c.unicodeScalars.contains { $0.properties.isIdeographic || (0x3000...0x30FF).contains($0.value) || (0xFF00...0xFFEF).contains($0.value) }
    }
    if last.isWhitespace || first.isWhitespace || first.isPunctuation || ideographic(last) || ideographic(first) { return a + b }
    return a + " " + b
}

let engine = AVAudioEngine()
// `--file <audio>` transcribes a recording instead of the microphone, so the
// recognizers can be checked without speaking.
let file = CommandLine.arguments.firstIndex(of: "--file").flatMap {
    CommandLine.arguments.indices.contains($0 + 1) ? CommandLine.arguments[$0 + 1] : nil
}
var candidates: [Candidate] = []
var finished = false
var stopping = false
var listening = false
var tapped = false
var lastLevel = DispatchTime.now()

func best() -> Candidate? {
    // Ties, including before anything is finalized, go to the earlier
    // language in the Mac's preferred-language list.
    candidates.enumerated().max { a, b in
        a.element.score != b.element.score ? a.element.score < b.element.score : a.offset > b.offset
    }?.element
}
func publish() {
    guard let choice = best() else { return }
    emit(["type": "partial", "text": choice.text, "language": choice.name])
}
func finish(_ error: String? = nil, cancelled: Bool = false) {
    guard !finished else { return }
    finished = true
    stopAudio()
    let text = cancelled ? "" : best()?.text ?? ""
    if let error = error { emit(["type": "error", "message": error, "text": text]) }
    else { emit(["type": cancelled ? "cancelled" : "final", "text": text, "language": best()?.name ?? ""]) }
    output.sync {}
    exit(0)
}
func stopAudio() {
    engine.stop()
    if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
    listening = false
}
func stop() {
    guard !finished && !stopping else { return }
    // Stopping while models download means there is nothing to transcribe.
    guard listening else { finish(cancelled: true); return }
    stopping = true
    stopAudio()
    for candidate in candidates { candidate.input.finish() }
    Task { @MainActor in
        await withTaskGroup(of: Void.self) { group in
            for candidate in candidates {
                group.addTask {
                    try? await candidate.analyzer.finalizeAndFinishThroughEndOfInput()
                    await candidate.results?.value
                }
            }
        }
        finish()
    }
    // Finalizing normally takes well under a second.
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { finish() }
}

/// The Mac's preferred languages that on-device dictation supports, in order.
@MainActor func preferredLocales() async -> [Locale] {
    var locales: [Locale] = []
    for identifier in Locale.preferredLanguages {
        if let locale = await DictationTranscriber.supportedLocale(equivalentTo: Locale(identifier: identifier)),
           !locales.contains(where: { $0.identifier == locale.identifier }) {
            locales.append(locale)
        }
    }
    // Each language runs its own model, so a few cover most speakers.
    return Array(locales.prefix(4))
}
func transcriber(_ locale: Locale) -> DictationTranscriber {
    DictationTranscriber(locale: locale, contentHints: [], transcriptionOptions: [.punctuation],
                         reportingOptions: [.volatileResults, .frequentFinalization],
                         attributeOptions: [.transcriptionConfidence])
}
/// Downloads models for languages used for the first time. A language that
/// cannot be installed (offline, unsupported) is left out.
@MainActor func installed(_ locales: [Locale]) async -> [Locale] {
    var ready: [Locale] = []
    for locale in locales where !finished {
        if await AssetInventory.status(forModules: [transcriber(locale)]) == .installed { ready.append(locale); continue }
        let name = Locale.current.localizedString(forIdentifier: locale.identifier) ?? locale.identifier
        do {
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber(locale)]) {
                let report = {
                    emit(["type": "preparing", "message": "Downloading the \(name) speech model (first use only)…",
                          "progress": request.progress.fractionCompleted])
                }
                report()
                let timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in report() }
                defer { timer.invalidate() }
                try await request.downloadAndInstall()
            }
            ready.append(locale)
        } catch {
            emit(["type": "preparing", "message": "The \(name) speech model could not be downloaded; continuing without it."])
        }
    }
    return ready
}
func level(_ buffer: AVAudioPCMBuffer) {
    let now = DispatchTime.now()
    guard now.uptimeNanoseconds - lastLevel.uptimeNanoseconds > 50_000_000,
          let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
    lastLevel = now
    var sum: Float = 0
    for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
    let decibels = 20 * log10(max(sqrt(sum / Float(buffer.frameLength)), 1e-7))
    // Room noise sits near -55 dB and close speech near -10 dB.
    emit(["type": "level", "value": Double(max(0, min(1, (decibels + 55) / 45)))])
}
func converted(_ buffer: AVAudioPCMBuffer, _ converter: AVAudioConverter?) -> AVAudioPCMBuffer? {
    guard let converter = converter else { return buffer }
    let ratio = converter.outputFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 16
    guard let result = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else { return nil }
    var consumed = false
    var error: NSError?
    converter.convert(to: result, error: &error) { _, status in
        if consumed { status.pointee = .noDataNow; return nil }
        consumed = true
        status.pointee = .haveData
        return buffer
    }
    return error == nil ? result : nil
}

@MainActor func start() async {
    let locales = await installed(await preferredLocales())
    guard !finished else { return }
    guard !locales.isEmpty else {
        finish("No on-device speech model is available. Check your connection, then add a supported language in System Settings > General > Language & Region.")
        return
    }
    candidates = locales.map { Candidate($0, transcriber($0)) }
    let recording = try? file.map { try AVAudioFile(forReading: URL(fileURLWithPath: $0)) }
    let natural = recording?.processingFormat ?? engine.inputNode.outputFormat(forBus: 0)
    guard natural.sampleRate > 0 && natural.channelCount > 0 else {
        finish(file == nil ? "No microphone is available. Check your sound input in System Settings." : "The recording could not be read."); return
    }
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(
        compatibleWith: candidates.map(\.transcriber), considering: natural) else {
        finish("Speech recognition is unavailable. Check macOS Dictation settings and try again."); return
    }
    let converter = format == natural ? nil : AVAudioConverter(from: natural, to: format)
    do {
        for candidate in candidates {
            try await candidate.analyzer.prepareToAnalyze(in: format)
            try await candidate.analyzer.start(inputSequence: candidate.stream)
            candidate.results = Task { @MainActor in
                do {
                    for try await result in candidate.transcriber.results {
                        let text = String(result.text.characters)
                        if result.isFinal {
                            candidate.finalized = joined(candidate.finalized, text)
                            candidate.volatile = ""
                            for run in result.text.runs {
                                guard let value = run.transcriptionConfidence else { continue }
                                let length = Double(result.text[run.range].characters.count)
                                candidate.confidence += value * length
                                candidate.weight += length
                            }
                        } else { candidate.volatile = text }
                        if !stopping { publish() }
                    }
                } catch {
                    // One language failing leaves the others running.
                }
            }
        }
    } catch {
        finish("Speech recognition could not start. Check macOS Dictation settings and try again."); return
    }
    guard !finished else { return }
    let hear = { (buffer: AVAudioPCMBuffer) in
        level(buffer)
        guard let audio = converted(buffer, converter) else { return }
        for candidate in candidates { candidate.input.yield(AnalyzerInput(buffer: audio)) }
    }
    if let recording = recording {
        listening = true
        emit(["type": "listening", "language": best()?.name ?? ""])
        while let buffer = AVAudioPCMBuffer(pcmFormat: natural, frameCapacity: 4096),
              (try? recording.read(into: buffer)) != nil, buffer.frameLength > 0 { hear(buffer) }
        stop()
        return
    }
    engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: natural) { buffer, _ in hear(buffer) }
    tapped = true
    listening = true
    do {
        engine.prepare()
        try engine.start()
        emit(["type": "listening", "language": best()?.name ?? ""])
        // On-device recognition has no service time limit; this keeps one
        // dictation to a message-sized length.
        DispatchQueue.main.asyncAfter(deadline: .now() + 300) { stop() }
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
if file != nil { Task { @MainActor in await start() } }
else { AVCaptureDevice.requestAccess(for: .audio) { allowed in
    DispatchQueue.main.async {
        guard !finished else { return }
        guard allowed else {
            finish("Allow Microphone access for Research Workbench in System Settings > Privacy & Security, then restart the app."); return
        }
        Task { @MainActor in await start() }
    }
} }
RunLoop.main.run()
