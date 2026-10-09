# Research Project Inventory

Reviewed October 9, 2026. Sources: personal website, NAISS Lab website and local source repositories; the logged-in Overleaf project list contained 190 entries. This is a curated snapshot, not a live synchronization.

The intended reader is Shinan Liu, choosing research projects for Research Workbench. CVs, templates, homework, duplicate submissions, websites and borrowed libraries are supporting material rather than separate research projects.

## Curation Decisions

- Keep one project for the code and paper of FlowWise, PACC, TabQueryBench, DataAlloy and IoT Unifier.
- Keep TraceCodec, TraceForge, TraceFoundry and TraceModel RSI separate: their local descriptions address representation, conditional trace generation, workload synthesis and iterative validation.
- DataAlloy and DataEvolve are grouped because the local DataEvolve manuscript explicitly defines its system as DATALLOY.
- Treat Overleaf venue/year labels as draft context. The project list establishes title and link, not submission or acceptance.
- Keep generic He Sun venue drafts unmapped until their manuscript titles are checked.
- Attach no invented deadlines. Record accepted work in Accepted, with Published reserved for established publication records.
- Preserve existing projects when adding candidates; imports skip existing catalog IDs.

## Current Research (34)

| Project | Area / Topic | Suggested Stage | Evidence and Limit |
| --- | --- | --- | --- |
| FlowWise | ml / Model Serving | accepted | SoCC 2026 acceptance is recorded on the lab website. |
| PACC | ml / Traffic Representation | submitted | Lab website lists this preprint as In Submission; the exact venue needs confirmation. |
| TraceCodec | ml / Network Synthesis | submitted | Lab website lists this preprint as In Submission; no target venue is verified. |
| TraceForge | ml / Network Synthesis | writing | Stage inferred from the local draft; confirm the current submission state. |
| TabQueryBench | ml / Tabular Data & Benchmarks | submitted | Website: In Submission. Overleaf includes ICLR and VLDB variants; confirm the active version. |
| DataAlloy / DataEvolve | ml / Tabular Data & Benchmarks | writing | Stage inferred from the local draft; confirm the current submission state. |
| TraceFoundry | ml / Workload Synthesis | experiments | October 8 local records show ongoing training and incomplete final scientific comparisons. |
| Trace-Conditioned Scenario Synthesis | ml / Network Synthesis | writing | Stage inferred from the local draft; confirm the current submission state. |
| TraceModel RSI | ml / Network Synthesis | experiments | Local README describes a preliminary study; confirm the latest experiment and paper state. |
| Synthetic Network Data SoK | ml / Network Synthesis | writing | Active Overleaf manuscript; topic follows its title, and submission state needs confirmation. |
| PG-SFT | ml / Agent Learning | submitted | Lab website: In Submission. Overleaf draft is labelled ICLR 2027; target and submission receipt need confirmation. |
| SpliceLeak | security / AI Infrastructure Security | submitted | Lab website lists this preprint as In Submission. |
| HillInfer | ml / Model Serving | submitted | Lab website lists this preprint as In Submission. |
| A SoK for SoCs | security / Threat Intelligence | submitted | Lab website: In Submission. Overleaf manuscript is labelled NDSS 2027; confirm the actual submission. |
| GhostAccess | security / AI Infrastructure Security | accepted | MICRO 2026 acceptance is recorded on the lab website; Overleaf has a camera-ready draft. |
| Synthetic Traffic Privacy | security / Network Privacy | accepted | IMC 2026 acceptance is recorded on the lab website; exact publication state needs confirmation. |
| NetGuard / Generative Active Adaptation | security / Network Detection | accepted | CoNEXT 2026 acceptance is recorded on the lab website. |
| LLM Resource Fingerprints | security / AI Infrastructure Security | experiments | Local repository documents experiments and results; publication state is unverified. |
| Agent Causal Traceroute | security / Agent Assurance | exploration | Local preliminary analysis and proposal wording exist; a completed system is not established. |
| IoT Semantic Unifier | cps / Smart Environments | writing | Stage inferred from the local draft; confirm the current submission state. |
| Air–Ground Safety–Security | cps / Cooperative Driving | experiments | Local repository describes the funded engineering stack and evaluation plan; final outcomes are unverified. |
| SafeCoop | cps / Cooperative Driving | submitted | Lab website lists this preprint as In Submission. |
| QuanCache | ml / Model Serving | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| IntentEval | ml / Agent Evaluation | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| Web RAG | ml / Retrieval Systems | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| RAG Serving Survey | ml / Retrieval Systems | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| DeepStore | ml / Network Trace Storage | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| Lumen | ml / Model Serving | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| DemoteAttack | security / AI Infrastructure Security | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| ToolPulse / Tool Side Channel | security / AI Infrastructure Security | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| Agent Firewall | security / Agent Assurance | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| Tick Tells | security / Sensor Side Channels | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| Agent Intent Drift | security / Agent Assurance | writing | Project title and link verified; topic and stage are provisional. Venue labels do not prove submission. |
| ECS 2027/28 Proposal | ml / Research Proposals | writing | Overleaf proposal title is verified; research scope and current stage need review. |

## Archive

| Project | Venue | Suggested Stage |
| --- | --- | --- |
| NetSSM | ACM CoNEXT 2026 | accepted |
| WiFinger | NDSS 2026 | published |
| IoT Data Minimization | VLDB 2026 | published |
| On-Device Evidence Gathering | ACM IMWUT/UbiComp 2026 | accepted |
| JITI | ACM CoNEXT 2025 | published |
| CATO | USENIX NSDI 2025 | published |
| NetDiffusion | ACM SIGMETRICS 2024 | published |
| LEAF | ACM CoNEXT 2023 | published |
| AMIR | ACM IMWUT/UbiComp 2023 | published |
| GPS Spoofing & Defense | USENIX Security 2018 / 2021; ACM WiSec 2025 | published |

## Project Sources

### FlowWise

Stateful fast-slow model serving for streaming network traffic intelligence.

SoCC 2026 acceptance is recorded on the lab website.

Code and manuscript are one project. Older fast-serving / SIGMETRICS drafts are historical versions. Acceptance does not establish a camera-ready deadline.

- Manuscript: `fast-serving/paper.tex`
- Code: `FlowWise/`
- [Overleaf](https://www.overleaf.com/project/6a2f8e387f9694ae91f658bd)
- [Paper](https://arxiv.org/pdf/2402.03694)
- [Code](https://github.com/noise-lab/FlowWise)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: flowwise, ACM SoCC 2026.
- Evidence: fast-serving/paper.tex title; FlowWise/README.md.
- Evidence: Overleaf: fast-serving.

### PACC

Protocol-aware cross-layer compression for compact network traffic representation.

Lab website lists this preprint as In Submission; the exact venue needs confirmation.

- Manuscript: `pacc-paper/paper.tex`
- Code: `pacc/`
- [Overleaf](https://www.overleaf.com/project/691ffe173ba0f538f6dda5e1)
- [Paper](https://arxiv.org/pdf/2602.08331)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: pacc, In Submission.
- Evidence: pacc-paper/paper.tex; pacc/README.md.
- Evidence: Overleaf: Cross-layer Traffic Representation.

### TraceCodec

A compiler-backed neural codec for stateful multi-flow network traffic traces.

Lab website lists this preprint as In Submission; no target venue is verified.

The local filename mentions NeurIPS 2026. A filename alone does not confirm the current venue or submission outcome.

- Manuscript: `trace_codec_paper/neurips_2026.tex`
- [Overleaf](https://www.overleaf.com/project/69e73c6f0ccc77e2852a14f9)
- [Paper](https://arxiv.org/pdf/2605.29941)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: tracecodec, In Submission.
- Evidence: trace_codec_paper/neurips_2026.tex.
- Evidence: Overleaf: trace_codec_paper.

### TraceForge

Replayable what-if PCAP generation using action semantics and latent flow matching.

Stage inferred from the local draft; confirm the current submission state.

Keep separate from TraceCodec: the local drafts describe generation and representation as separate projects.

- Manuscript: `traceforge_paper/main.tex`
- [Overleaf](https://www.overleaf.com/project/69b7b76b98537bc2b0391a3b)
- Evidence: traceforge_paper/README.md and main.tex.
- Evidence: Overleaf: traceforge_paper.

### TabQueryBench

A query-centric benchmark for synthetic tabular data.

Website: In Submission. Overleaf includes ICLR and VLDB variants; confirm the active version.

One project, multiple venue variants. Use the collaborator-owned ICLR draft rather than assuming the personal duplicate is authoritative.

- Manuscript: `tabquerybench_paper/main.tex`
- VLDB variant: `tabquerybench_paper_VLDB/main.tex`
- [Overleaf · ICLR](https://www.overleaf.com/project/6a8bc8f217dc43f4e5fa01b2)
- [Overleaf · VLDB](https://www.overleaf.com/project/6a38eef51c255f2d278ae5a5)
- [Overleaf · earlier draft](https://www.overleaf.com/project/69b27219c555c38a69bb2156)
- [Paper](https://arxiv.org/pdf/2607.03926)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: tabquerybench, In Submission.
- Evidence: Both local manuscript titles match.
- Evidence: Overleaf: three version groups, including a duplicate ICLR copy.

### DataAlloy / DataEvolve

Evolving executable data engines for synthetic tabular and relational data.

Stage inferred from the local draft; confirm the current submission state.

DataEvolve is the code workspace; the local manuscript calls the system DATALLOY. Keep the website and MVP directories as supporting assets.

- Manuscript: `dataevolve-paper/main.tex`
- Code: `DataEvolve/`
- Earlier prototype: `datalloy-mvp/`
- [Overleaf](https://www.overleaf.com/project/69b271dcf6877b9e883f6b84)
- Evidence: dataevolve-paper/main.tex defines the system as DATALLOY.
- Evidence: DataEvolve/README.md describes the synthetic-data workbench.
- Evidence: Overleaf: DataAlloy-paper.

### TraceFoundry

Cross-trace synthesis of GPU workload records and evaluation on held-out workloads.

October 8 local records show ongoing training and incomplete final scientific comparisons.

The local paper and implementations identify TraceFoundry. The Overleaf title is related but its content was not inspected, so confirm that association. Completed donor pilots do not establish held-out generality.

- Manuscript: `Cross-Trace-Synth/main.tex`
- Current code: `TraceFoundry_Codex/`
- Alternative implementation: `TraceFoundry_Claude/`
- [Overleaf · Synthetic Job Schedulers](https://www.overleaf.com/project/691f2bccaa2c6b86b787f83a)
- Evidence: Cross-Trace-Synth/main.tex: TraceFoundry macro and Cross-Trace Synthesis for More Generalized GPU Workloads.
- Evidence: TraceFoundry_Codex/README.md, current execution dated October 8.
- Evidence: Overleaf: Synthetic Job Schedulers (candidate manuscript association).

### Trace-Conditioned Scenario Synthesis

Infer network scenarios from traces, then regenerate traffic with executable simulators.

Stage inferred from the local draft; confirm the current submission state.

Group the two implementations under the same research question. The HotNets filename and draft do not prove submission or acceptance.

- Manuscript: `ns3-synth-hotnets/main.tex`
- Python implementation: `ns3-synth/`
- Rust implementation: `netscene/`
- [Overleaf](https://www.overleaf.com/project/6a4bb379bbed397096941c01)
- Evidence: ns3-synth-hotnets/README.md and main.tex.
- Evidence: ns3-synth/README.md; netscene/README.md.
- Evidence: Overleaf: Trace-Conditioned Scenario Synthesis as a New Abstraction for Traffic Generation.

### TraceModel RSI

Agent-guided measurement and iterative improvement of cross-condition traffic generation.

Local README describes a preliminary study; confirm the latest experiment and paper state.

A separate validation study supporting the proposal. Keep distinct from TraceForge, which is the generator used by the study.

- Experiments: `TraceModel_RSI/`
- Evidence: TraceModel_RSI/README.md: ECS 27/28 Task 3 preliminary study.

### Synthetic Network Data SoK

Systematizing and orchestrating opportunities for synthetic network data.

Active Overleaf manuscript; topic follows its title, and submission state needs confirmation.

- [Overleaf](https://www.overleaf.com/project/66f6d7c605d879e23c28157a)
- Evidence: Overleaf project title: Towards Systematizing and Orchestrating the Opportunities of Synthetic Network Data.

### PG-SFT

Balance capability acquisition and retention in offline agent fine-tuning.

Lab website: In Submission. Overleaf draft is labelled ICLR 2027; target and submission receipt need confirmation.

- [Overleaf](https://www.overleaf.com/project/6ab54ac0bd19fbe9251d9c7e)
- [Paper](https://arxiv.org/pdf/2610.00949)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: pg-sft, In Submission.
- Evidence: Overleaf: pgsft-iclr27.

### SpliceLeak

Agent-assisted side-channel attacks on non-prefix KV cache in RAG.

Lab website lists this preprint as In Submission.

Several Overleaf drafts owned by He Sun have generic venue names. No exact draft association is asserted.

- [Paper](https://arxiv.org/pdf/2606.21842)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: spliceleak.

### HillInfer

Long-context edge LLM inference with hierarchical KV eviction using SmartSSD.

Lab website lists this preprint as In Submission.

No exact Overleaf association is verified for the generically named FAST or EuroSys drafts.

- [Paper](https://arxiv.org/pdf/2602.18750)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: hillinfer.

### A SoK for SoCs

Systematize AI-based cyber threat intelligence generation and sharing.

Lab website: In Submission. Overleaf manuscript is labelled NDSS 2027; confirm the actual submission.

- [Overleaf](https://www.overleaf.com/project/6659126c71e8342bc9ac2d88)
- [Paper](https://arxiv.org/pdf/2609.01174)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: sok-for-socs.
- Evidence: Overleaf: ThreatIntelligence_SOK_NDSS-27.

### GhostAccess

Infer GPU workloads through a CPU LLC side channel under unified memory.

MICRO 2026 acceptance is recorded on the lab website; Overleaf has a camera-ready draft.

Combine earlier CCS and MICRO submissions with the camera-ready version in this project.

- [Overleaf · camera-ready](https://www.overleaf.com/project/6a217438f29db013e380c727)
- [Lab publication](https://naisslab.github.io/#publications)
- Evidence: NAISS Lab: ghostaccess and July 2026 acceptance news.
- Evidence: Overleaf: paper-um-llc-sca-micro2026-camera-ready.

### Synthetic Traffic Privacy

Quantify privacy implications of high-fidelity synthetic network traffic.

IMC 2026 acceptance is recorded on the lab website; exact publication state needs confirmation.

The newest named local folder is attached for convenience, not asserted to be the authoritative camera-ready source. Keep marked-diff folders as supporting assets.

- Manuscript: `synthetic_privacy/latest_new/paper.tex`
- [Paper](https://arxiv.org/pdf/2511.20497)
- [Code](https://github.com/VanTranHong/IMC-26-privacy-traffic-generator)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: synthetic-traffic-privacy, ACM IMC 2026.
- Evidence: synthetic_privacy: submitted, latest and latest_new manuscript variants.

### NetGuard / Generative Active Adaptation

Generative active adaptation for drifting and imbalanced network intrusion detection.

CoNEXT 2026 acceptance is recorded on the lab website.

Local exports include marked differences and templates, so no clean LaTeX entry file is attached automatically. Use the verified Overleaf link.

- Revision exports: `NetGuard/`
- [Overleaf](https://www.overleaf.com/project/692514a7be20280a16b0ed48)
- [Paper](https://arxiv.org/pdf/2503.03022)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: generative-active-adaptation.
- Evidence: NetGuard Version 3598 archive contains the matching manuscript title.
- Evidence: Overleaf: CoNext 2026 NetGuard.

### LLM Resource Fingerprints

Identify an agent’s underlying model from input/output token-usage histories.

Local repository documents experiments and results; publication state is unverified.

- Code & experiments: `llm-resource-fingerprints/`
- Evidence: llm-resource-fingerprints/README.md.

### Agent Causal Traceroute

Use agent, message, tool and environment traces to study failure attribution.

Local preliminary analysis and proposal wording exist; a completed system is not established.

- Preliminary analysis: `IoA-telemetry/`
- Evidence: IoA-telemetry/preliminary-results-agent-traceroute.md.
- Evidence: IoA-telemetry/traceroute-failure-analysis.md.

### IoT Semantic Unifier

Use the home router to unify semantic observations in mixed smart homes.

Stage inferred from the local draft; confirm the current submission state.

- Manuscript: `iot-unification-paper/main.tex`
- Rust code: `iot-unifier/`
- [Overleaf](https://www.overleaf.com/project/69c7f17cb7ab304548fc773b)
- Evidence: iot-unification-paper/main.tex: The Home Router as a Semantic Unifier for Mixed Smart Homes.
- Evidence: iot-unifier/README.md describes early implementation.
- Evidence: Overleaf: iot-unification-paper.

### Air–Ground Safety–Security

Co-design safety and security for air–ground cooperative driving.

Local repository describes the funded engineering stack and evaluation plan; final outcomes are unverified.

Keep separate from SafeCoop. Shared driving context does not establish that they are the same project.

- Code & design: `AirGround-CollaborativeDriving/`
- Evidence: AirGround-CollaborativeDriving/README.md: AGCD-SafetySec and HKU Faculty Interdisciplinary Fund.

### SafeCoop

Study full-stack safety in agentic collaborative driving.

Lab website lists this preprint as In Submission.

- [Paper](https://www.arxiv.org/pdf/2510.18123)
- [Code](https://github.com/taco-group/SafeCoop)
- [Project website](https://xiangbogaobarry.github.io/SafeCoop/)
- [NAISS Lab](https://naisslab.github.io/)
- Evidence: NAISS Lab: safecoop.

### QuanCache

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/6a71990a776124592438b8d5)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### IntentEval

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/69a33c79fddb7cd41fd48b65)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### Web RAG

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/6ac34713c3c1f48953293fc1)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### RAG Serving Survey

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/6ac7c300a8966b68c3f73686)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### DeepStore

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/68dc295101f3f346f3172026)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### Lumen

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/6a4ca5681b04014daa2e2a29)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### DemoteAttack

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/6aba0f785ea5c8567e040c1e)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### ToolPulse / Tool Side Channel

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/69b3ad8ca05656060df75af1)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### Agent Firewall

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/6a4b23a010c03b93d5ac5ee7)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### Tick Tells

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/6a6185c7f46612423237b51b)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### Agent Intent Drift

Overleaf manuscript. Confirm the research scope and active version before prioritizing.

Project title and link verified; topic and stage are provisional. Venue labels do not prove submission.

Some titles have venue/year labels. Those labels are not evidence of submission, acceptance or a deadline.

- [Overleaf](https://www.overleaf.com/project/6a7af6352c6872bc76381019)
- Evidence: Overleaf project list, read October 9, 2026. Manuscript body was not inspected.

### ECS 2027/28 Proposal

Proposal workspace supporting the next network-generation research program.

Overleaf proposal title is verified; research scope and current stage need review.

- [Overleaf](https://www.overleaf.com/project/6aa7633071bf1ffa4d3a9df0)
- Evidence: Overleaf: ECS-27to28.
- Evidence: TraceModel_RSI/README.md identifies an ECS 27/28 Task 3 study.

### NetSSM

State-space models for multi-flow state-aware network trace generation.

Acceptance recorded; publication state needs confirmation. ACM CoNEXT 2026

- [Paper](https://arxiv.org/pdf/2503.22663)
- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: netssm; ACM CoNEXT 2026.

### WiFinger

Fingerprint noisy IoT event traffic using packet-level sequence matching.

Published work listed on the personal and lab websites. NDSS 2026

- Code: `wifinger/`
- [Paper](https://arxiv.org/pdf/2508.03151)
- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: wifinger; NDSS 2026.

### IoT Data Minimization

Algorithmic data minimization for machine learning over IoT data streams.

Published work listed on the personal and lab websites. VLDB 2026

- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: iot-minimization; VLDB 2026.

### On-Device Evidence Gathering

Joint identity–action detection for evidence gathering on intimate partner infiltration.

Acceptance recorded; publication state needs confirmation. ACM IMWUT/UbiComp 2026

- [Paper](https://arxiv.org/pdf/2502.03682)
- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: on-device-evidence; ACM IMWUT/UbiComp 2026.

### JITI

Dynamic model serving for just-in-time traffic inference.

Published work listed on the personal and lab websites. ACM CoNEXT 2025

- [Paper](https://arxiv.org/pdf/2302.11718)
- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: jiti; ACM CoNEXT 2025.

### CATO

End-to-end optimization of ML-based traffic analysis pipelines.

Published work listed on the personal and lab websites. USENIX NSDI 2025

- [Paper](https://www.usenix.org/system/files/nsdi25-wan-gerry.pdf)
- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: cato; USENIX NSDI 2025.

### NetDiffusion

Protocol-constrained traffic generation for network data augmentation.

Published work listed on the personal and lab websites. ACM SIGMETRICS 2024

- [Paper](https://dl.acm.org/doi/pdf/10.1145/3639037)
- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: netdiffusion; ACM SIGMETRICS 2024.

### LEAF

Navigate concept drift in cellular networks.

Published work listed on the personal and lab websites. ACM CoNEXT 2023

- [Paper](https://www.shinan.info/wp-content/uploads/2023/09/liu-conext23.pdf)
- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: leaf; ACM CoNEXT 2023.

### AMIR

Active multimodal interaction recognition from video and network traffic.

Published work listed on the personal and lab websites. ACM IMWUT/UbiComp 2023

- [Paper](https://www.shinan.info/wp-content/uploads/2023/03/liu-imwut23.pdf)
- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: amir; ACM IMWUT/UbiComp 2023.

### GPS Spoofing & Defense

A research line spanning stealthy navigation attacks, chipset-based defenses and multi-antenna spoofing.

Published work listed on the personal and lab websites. USENIX Security 2018 / 2021; ACM WiSec 2025

- [NAISS Lab](https://naisslab.github.io/)
- [Personal website](https://www.shinan.info/)
- Evidence: NAISS Lab publication record: gps-security; USENIX Security 2018 / 2021; ACM WiSec 2025.

