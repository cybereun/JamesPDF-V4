/**
 * PDF 텍스트 추출 (pdfjs-dist static import 기반)
 *
 * polyfill을 먼저 import해야 DOMMatrix/Path2D/pdfjsWorker가 주입됨.
 * ES 모듈 호이스팅 때문에 별도 파일로 분리되어 있음.
 */

import type { ParseResult, InternalParseResult, IRBlock, IRTable, DocumentMetadata, ParseOptions, BoundingBox, ParseWarning, OutlineItem } from "../types.js"
import { HEADING_RATIO_H1, HEADING_RATIO_H2, HEADING_RATIO_H3 } from "../types.js"
import { KordocError, safeMin, safeMax } from "../utils.js"
import { parsePageRange } from "../page-range.js"
import { blocksToMarkdown } from "../table/builder.js"
import { extractLines, preprocessLines, filterPageBorderLines, buildTableGrids, extractCells, mapTextToCells, cellTextToString, detectEvenSpacedItems, type TextItem, type TableGrid, type ExtractedCell } from "./line-detector.js"
import { detectClusterTables, type ClusterItem } from "./cluster-detector.js"
import { computePageQuality, summarizeDocumentQuality, stripControlChars, type PageQuality } from "./quality.js"
// polyfill 먼저 (ES 모듈 호이스팅되므로 별도 파일 필수)
import "./polyfill.js"
import { getDocument, OPS, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs"

// worker 비활성화 (polyfill에서 pdfjsWorker를 이미 주입했으므로)
GlobalWorkerOptions.workerSrc = ""

// ─── 안전 한계값 (구조적 파싱과 무관) ────────────────
const MAX_PAGES = 5000
const MAX_TOTAL_TEXT = 100 * 1024 * 1024 // 100MB
/** PDF 로딩 타임아웃 (30초) — 악성/대용량 PDF 무한 대기 방지 */
const PDF_LOAD_TIMEOUT_MS = 30_000

/** getDocument + 타임아웃 래퍼 */
async function loadPdfWithTimeout(buffer: ArrayBuffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      loadingTask.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { loadingTask.destroy(); reject(new KordocError("PDF 로딩 타임아웃 (30초 초과)")) }, PDF_LOAD_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

interface PdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName?: string
}

interface NormItem {
  text: string
  x: number
  y: number
  w: number
  h: number
  /** 폰트 높이(≈폰트 크기) — 헤딩 감지용 */
  fontSize: number
  fontName: string
  /** hidden text 여부 (투명/0pt) */
  isHidden: boolean
  /** pdfjs 공백 아이템이 이 아이템 직전에 있었음 — 단어 경계 힌트 */
  hasSpaceBefore?: boolean
}

export async function parsePdfDocument(buffer: ArrayBuffer, options?: ParseOptions): Promise<InternalParseResult> {
  // pdfjs-dist 는 전달받은 buffer 의 underlying storage 를 detach 할 수 있다.
  // 수식 OCR 은 같은 버퍼를 재사용해야 하므로 옵션 on 일 때만 clone 을 보관.
  const formulaBuffer: ArrayBuffer | null = options?.formulaOcr ? buffer.slice(0) : null
  const doc = await loadPdfWithTimeout(buffer)

  try {
    const pageCount = doc.numPages
    if (pageCount === 0) throw new KordocError("PDF에 페이지가 없습니다.")

    // 메타데이터 추출 (best-effort)
    const metadata: DocumentMetadata = { pageCount }
    await extractPdfMetadata(doc, metadata)

    const blocks: IRBlock[] = []
    const warnings: ParseWarning[] = []
    const pageQuality: PageQuality[] = []
    let totalChars = 0
    let totalTextBytes = 0
    const effectivePageCount = Math.min(pageCount, MAX_PAGES)

    // 페이지 범위 필터링
    const pageFilter = options?.pages ? parsePageRange(options.pages, effectivePageCount) : null
    const totalTarget = pageFilter ? pageFilter.size : effectivePageCount

    // 전체 문서의 폰트 크기 빈도 수집 (헤딩 감지용) — 빈도 Map으로 메모리 절약
    const fontSizeFreq = new Map<number, number>()
    const pageHeights = new Map<number, number>()

    let parsedPages = 0
    for (let i = 1; i <= effectivePageCount; i++) {
      if (pageFilter && !pageFilter.has(i)) continue
      try {
        const page = await doc.getPage(i)
        const tc = await page.getTextContent()
        const viewport = page.getViewport({ scale: 1 })
        pageHeights.set(i, viewport.height)
        const rawItems = tc.items as PdfTextItem[]
        const items = normalizeItems(rawItems)

        // hidden text 필터링 + 경고 수집
        const { visible, hiddenCount } = filterHiddenText(items, viewport.width, viewport.height)
        if (hiddenCount > 0) {
          warnings.push({ page: i, message: `${hiddenCount}개 숨겨진 텍스트 요소 필터링됨`, code: "HIDDEN_TEXT_FILTERED" })
        }

        // 폰트 크기 빈도 수집
        for (const item of visible) {
          if (item.fontSize > 0) fontSizeFreq.set(item.fontSize, (fontSizeFreq.get(item.fontSize) || 0) + 1)
        }

        // 선 기반 테이블 감지를 위한 operatorList
        const opList = await page.getOperatorList()

        const pageBlocks = extractPageBlocksWithLines(visible, i, opList, viewport.width, viewport.height)
        for (const b of pageBlocks) blocks.push(b)

        // 이미지 기반 PDF 감지 + 크기 제한용 문자 수 집계 + 페이지 품질 신호
        let pageText = ""
        for (const b of pageBlocks) {
          const t = b.text || ""
          totalChars += t.replace(/\s/g, "").length
          totalTextBytes += t.length * 2
          pageText += pageText ? "\n" + t : t
        }
        pageQuality.push(computePageQuality(i, pageText))
        if (totalTextBytes > MAX_TOTAL_TEXT) throw new KordocError("텍스트 추출 크기 초과")
        parsedPages++
        options?.onProgress?.(parsedPages, totalTarget)
      } catch (pageErr) {
        // 크기 초과는 전체 중단
        if (pageErr instanceof KordocError) throw pageErr
        warnings.push({ page: i, message: `페이지 ${i} 파싱 실패: ${pageErr instanceof Error ? pageErr.message : "알 수 없는 오류"}`, code: "PARTIAL_PARSE" })
      }
    }

    const parsedPageCount = parsedPages || (pageFilter ? pageFilter.size : effectivePageCount)
    if (totalChars / Math.max(parsedPageCount, 1) < 10) {
      if (options?.ocr) {
        try {
          const { ocrPages } = await import("../ocr/provider.js")
          const ocrBlocks = await ocrPages(doc, options.ocr, pageFilter, effectivePageCount)
          if (ocrBlocks.length > 0) {
            const ocrMarkdown = ocrBlocks.map(b => b.text || "").filter(Boolean).join("\n\n")
            return { markdown: ocrMarkdown, blocks: ocrBlocks, metadata, warnings, isImageBased: true, pageQuality, qualitySummary: summarizeDocumentQuality(pageQuality) }
          }
        } catch {
          // OCR 실패 시 원래 에러 반환
        }
      }
      throw Object.assign(new KordocError(`이미지 기반 PDF (${pageCount}페이지, ${totalChars}자)`), { isImageBased: true })
    }

    // 머리글/바닥글 필터링 (기본 ON — 명시적 false일 때만 비활성화)
    if (options?.removeHeaderFooter !== false && parsedPageCount >= 3) {
      const removed = removeHeaderFooterBlocks(blocks, pageHeights, warnings)
      // 필터링된 블록 제거 (뒤에서부터 삭제)
      for (let ri = removed.length - 1; ri >= 0; ri--) {
        blocks.splice(removed[ri], 1)
      }
    }

    // 수식 OCR (선택) — 기본 텍스트 추출과 별개로 페이지 이미지 렌더 후 수식만 검출/인식.
    // 실패 시 경고만 기록하고 일반 텍스트 추출 결과는 그대로 반환한다.
    if (options?.formulaOcr && formulaBuffer) {
      try {
        await applyFormulaOcr(formulaBuffer, blocks, pageFilter, effectivePageCount, warnings, options.onProgress)
      } catch (e) {
        warnings.push({
          message: `수식 OCR 실패: ${e instanceof Error ? e.message : String(e)}`,
          code: "PARTIAL_PARSE",
        })
      }
    }

    // 헤딩 감지: 폰트 크기 기반
    const medianFontSize = computeMedianFontSizeFromFreq(fontSizeFreq)
    if (medianFontSize > 0) {
      detectHeadings(blocks, medianFontSize)
    }

    // □/■ 마커 기반 서브헤딩 감지 (ODL 패턴)
    detectMarkerHeadings(blocks)

    // outline 구축
    const outline: OutlineItem[] = blocks
      .filter(b => b.type === "heading" && b.level && b.text)
      .map(b => ({ level: b.level!, text: b.text!, pageNumber: b.pageNumber }))

    // 메트릭 수집 끝났으니 블록 텍스트의 C0/C1 제어문자(NUL 등) 정리
    sanitizeBlockControlChars(blocks)

    // blocksToMarkdown로 통일 — 헤딩 마크다운 반영 (HWP5/HWPX와 일관성)
    let markdown = cleanPdfText(blocksToMarkdown(blocks))

    return {
      markdown,
      blocks,
      metadata,
      outline: outline.length > 0 ? outline : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      pageQuality,
      qualitySummary: summarizeDocumentQuality(pageQuality),
    }
  } finally {
    await doc.destroy().catch(() => {})
  }
}

// ─── PDF 메타데이터 추출 ────────────────────────────

async function extractPdfMetadata(doc: { getMetadata(): Promise<unknown> }, metadata: DocumentMetadata): Promise<void> {
  try {
    const result = await doc.getMetadata() as { info?: Record<string, unknown> } | null
    if (!result?.info) return
    const info = result.info

    if (typeof info.Title === "string" && info.Title.trim()) metadata.title = info.Title.trim()
    if (typeof info.Author === "string" && info.Author.trim()) metadata.author = info.Author.trim()
    if (typeof info.Creator === "string" && info.Creator.trim()) metadata.creator = info.Creator.trim()
    if (typeof info.Subject === "string" && info.Subject.trim()) metadata.description = info.Subject.trim()
    if (typeof info.Keywords === "string" && info.Keywords.trim()) {
      metadata.keywords = info.Keywords.split(/[,;]/).map((k: string) => k.trim()).filter(Boolean)
    }
    if (typeof info.CreationDate === "string") metadata.createdAt = parsePdfDate(info.CreationDate)
    if (typeof info.ModDate === "string") metadata.modifiedAt = parsePdfDate(info.ModDate)
  } catch {
    // best-effort
  }
}

/** PDF 날짜 형식 (D:YYYYMMDDHHmmSS) → ISO 8601 변환 */
function parsePdfDate(dateStr: string): string | undefined {
  const m = dateStr.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/)
  if (!m) return undefined
  const [, year, month = "01", day = "01", hour = "00", min = "00", sec = "00"] = m
  return `${year}-${month}-${day}T${hour}:${min}:${sec}`
}

/** 메타데이터만 추출 (전체 파싱 없이) — MCP parse_metadata용 */
export async function extractPdfMetadataOnly(buffer: ArrayBuffer): Promise<DocumentMetadata> {
  const doc = await loadPdfWithTimeout(buffer)

  try {
    const metadata: DocumentMetadata = { pageCount: doc.numPages }
    await extractPdfMetadata(doc, metadata)
    return metadata
  } finally {
    await doc.destroy().catch(() => {})
  }
}

// ═══════════════════════════════════════════════════════
// Hidden text 필터링 (prompt injection 방어)
// ═══════════════════════════════════════════════════════

function filterHiddenText(items: NormItem[], pageWidth: number, pageHeight: number): { visible: NormItem[]; hiddenCount: number } {
  let hiddenCount = 0
  const visible: NormItem[] = []

  for (const item of items) {
    // 0pt 폰트 / 너비 0 → 숨겨진 텍스트
    if (item.isHidden) { hiddenCount++; continue }
    // 페이지 범위 밖 (여백 10% 허용)
    const margin = Math.max(pageWidth, pageHeight) * 0.1
    if (item.x < -margin || item.x > pageWidth + margin || item.y < -margin || item.y > pageHeight + margin) {
      hiddenCount++; continue
    }
    visible.push(item)
  }

  return { visible, hiddenCount }
}

// ═══════════════════════════════════════════════════════
// 헤딩 감지 (폰트 크기 기반)
// ═══════════════════════════════════════════════════════

function computeMedianFontSizeFromFreq(freq: Map<number, number>): number {
  if (freq.size === 0) return 0
  let total = 0
  for (const count of freq.values()) total += count
  const sorted = [...freq.entries()].sort((a, b) => a[0] - b[0])
  const mid = Math.floor(total / 2)
  let cumulative = 0
  for (const [size, count] of sorted) {
    cumulative += count
    if (cumulative > mid) return size
  }
  return sorted[sorted.length - 1][0]
}

/**
 * 블록의 폰트 크기를 median과 비교하여 헤딩으로 승격.
 * - 150%+ → heading level 1
 * - 130%+ → heading level 2
 * - 115%+ → heading level 3
 * 조건: 짧은 텍스트 (200자 미만), 숫자만으로 구성되지 않음
 */
function detectHeadings(blocks: IRBlock[], medianFontSize: number): void {
  for (const block of blocks) {
    if (block.type !== "paragraph" || !block.text || !block.style?.fontSize) continue
    const text = block.text.trim()
    if (text.length === 0 || text.length > 200) continue
    // 숫자만이면 헤딩 아님
    if (/^\d+$/.test(text)) continue

    const ratio = block.style.fontSize / medianFontSize
    let level = 0
    if (ratio >= HEADING_RATIO_H1) level = 1
    else if (ratio >= HEADING_RATIO_H2) level = 2
    else if (ratio >= HEADING_RATIO_H3) level = 3

    if (level > 0) {
      block.type = "heading"
      block.level = level
      // PDF 균등배분 스페이스 제거 ("기 본 현 황" → "기본현황")
      // 한글 글자 사이에 단독 공백이 반복되면 균등배분으로 판단
      block.text = collapseEvenSpacing(text)
    }
  }
}

/**
 * 문자열 기반 균등배분 제거.
 * normalizeItems에서 분해 + 좌표 기반 감지가 주 경로이고, 여기는 안전망.
 * pdfjs가 이미 합친 "홍 보 담 당 관" 같은 TextItem 문자열에 적용.
 */
function collapseEvenSpacing(text: string): string {
  // 1. 전체가 균등배분: 토큰의 70%가 1글자
  const tokens = text.split(" ")
  const singleCharCount = tokens.filter(t => t.length === 1).length
  if (tokens.length >= 3 && singleCharCount / tokens.length >= 0.7) {
    return tokens.join("")
  }

  // 2. 부분 균등배분: 한글 1자가 3개+ 연속 (2자 단어는 건드리지 않음)
  // "홍 보 담 당 관" → "홍보담당관", "지 역 경 제 과" → "지역경제과"
  // "중동 사태 대응" (2자 단어)는 매칭 안 됨 → 공백 유지
  return text.replace(
    /(?<![가-힣])[가-힣](?: [가-힣\d]){2,}(?![가-힣])/g,
    match => match.replace(/ /g, ""),
  )
}

/**
 * 의사 테이블 감지: 실제 데이터 테이블이 아닌 텍스트가 우연히 테이블로 감지된 경우.
 */
function shouldDemoteTable(table: IRTable): boolean {
  const allCells = table.cells.flatMap(row => row.map(c => c.text.trim())).filter(Boolean)
  const allText = allCells.join(" ")

  // 텍스트 박스 패턴: 3행 이하 + 3열 이하 + <...> 또는 ㅇ 마커 포함
  // 공문서 "중점 추진사항" 등 요약 박스
  if (table.rows <= 3 && table.cols <= 3) {
    // 빈 셀이 과반 → 텍스트 박스 (테두리 안에 텍스트만 있는 형태)
    const totalCells = table.rows * table.cols
    const emptyCells = totalCells - allCells.length
    if (emptyCells >= totalCells * 0.3) return true

    // 마커 패턴 (ㅇ, □, ○, <> 등) → 텍스트성
    if (/[□■◆○●▶ㅇ]/.test(allText)) return true
    if (/<[^>]+>/.test(allText)) return true
  }

  if (allText.length > 200) return false
  // □, ○, ■ 마커 포함 + 3행 이하 → 텍스트성
  if (/[□■◆○●▶]/.test(allText) && table.rows <= 3) return true
  // 빈 셀이 과반 → 의사 테이블
  const totalCells = table.rows * table.cols
  const emptyCells = totalCells - allCells.length
  if (table.rows <= 2 && emptyCells > totalCells * 0.5) return true
  // 1행 + 숫자 데이터 없음 → 의사 테이블
  if (table.rows === 1 && !/\d{2,}/.test(allText)) return true
  return false
}

/** demote된 테이블을 구조화된 텍스트로 변환 */
function demoteTableToText(table: IRTable): string {
  const lines: string[] = []
  for (let r = 0; r < table.rows; r++) {
    const cells = table.cells[r].map(c => c.text.trim()).filter(Boolean)
    if (cells.length === 0) continue
    if (table.cols === 2 && cells.length === 2) {
      lines.push(`${cells[0]} : ${cells[1]}`)
    } else {
      // 각 셀 텍스트를 공백으로 합침 (br 태그는 줄바꿈으로 유지)
      lines.push(cells.join(" "))
    }
  }
  return lines.join("\n")
}

/** □/■ 마커 및 짧은 섹션명을 서브헤딩으로 변환 */
function detectMarkerHeadings(blocks: IRBlock[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type !== "paragraph" || !block.text) continue
    const text = block.text.trim()
    // □/■ + 한글로 시작하는 짧은 텍스트 (50자 미만)
    if (text.length < 50 && /^[□■◆◇▶]\s*[가-힣]/.test(text)) {
      block.type = "heading"
      block.level = 4
      continue
    }
    // 순수 한글 2-6자 + 앞뒤가 표/헤딩/빈블록 → 섹션 제목으로 추정
    // (예: "사업설명", "사업효과", "추진경위")
    if (/^[가-힣]{2,6}$/.test(text) && block.style?.fontSize) {
      const prev = blocks[i - 1]
      const next = blocks[i + 1]
      const prevIsStructural = !prev || prev.type === "table" || prev.type === "heading" || prev.type === "separator"
      const nextIsStructural = !next || next.type === "table" || next.type === "heading" || (next.type === "paragraph" && next.text && /^[□■◆○●]/.test(next.text.trim()))
      if (prevIsStructural || nextIsStructural) {
        block.type = "heading"
        block.level = 3
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
// XY-Cut 읽기 순서 알고리즘
// ═══════════════════════════════════════════════════════

interface TextRegion {
  items: NormItem[]
  minX: number; minY: number; maxX: number; maxY: number
}

/**
 * XY-Cut: 페이지를 재귀적으로 X/Y축 공백으로 분할하여 읽기 순서 결정.
 * - Y축 분할 (수평 공백 감지) → 위에서 아래
 * - X축 분할 (수직 공백 감지) → 왼쪽에서 오른쪽
 * - 분할 불가능하면 리프 노드 (하나의 텍스트 블록)
 */
/** 재귀 깊이 제한 — 수천 아이템의 pathological 레이아웃에서 스택 오버플로 방지 */
const MAX_XYCUT_DEPTH = 50

function xyCutOrder(items: NormItem[], gapThreshold: number, depth = 0): NormItem[][] {
  if (items.length === 0) return []
  if (items.length <= 2 || depth >= MAX_XYCUT_DEPTH) return [items]

  const region = computeRegion(items)

  // Y축 분할 시도 (수평 공백 감지)
  const ySplit = findYSplit(items, region, gapThreshold)
  if (ySplit !== null) {
    const upper = items.filter(i => i.y > ySplit)
    const lower = items.filter(i => i.y <= ySplit)
    // 빈 파티션 방어 — 한쪽이 비면 분할 의미 없음
    if (upper.length > 0 && lower.length > 0 && upper.length < items.length) {
      return [...xyCutOrder(upper, gapThreshold, depth + 1), ...xyCutOrder(lower, gapThreshold, depth + 1)]
    }
  }

  // X축 분할 시도 (수직 공백 감지)
  const xSplit = findXSplit(items, region, gapThreshold)
  if (xSplit !== null) {
    const left = items.filter(i => i.x + i.w / 2 < xSplit)
    const right = items.filter(i => i.x + i.w / 2 >= xSplit)
    if (left.length > 0 && right.length > 0 && left.length < items.length) {
      return [...xyCutOrder(left, gapThreshold, depth + 1), ...xyCutOrder(right, gapThreshold, depth + 1)]
    }
  }

  // 분할 불가 → 리프 노드
  return [items]
}

function computeRegion(items: NormItem[]): TextRegion {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const i of items) {
    if (i.x < minX) minX = i.x
    if (i.y < minY) minY = i.y
    if (i.x + i.w > maxX) maxX = i.x + i.w
    if (i.y + i.h > maxY) maxY = i.y + i.h
  }
  return { items, minX, minY, maxX, maxY }
}

/** Y축 분할점 찾기 — 수평 공백 밴드 중 가장 넓은 갭 */
function findYSplit(items: NormItem[], _region: TextRegion, gapThreshold: number): number | null {
  // 아이템을 Y좌표로 정렬 (내림차순 — 위에서 아래)
  const sorted = [...items].sort((a, b) => b.y - a.y)
  let bestGap = gapThreshold
  let bestSplit: number | null = null

  for (let i = 1; i < sorted.length; i++) {
    const prevBottom = sorted[i - 1].y - sorted[i - 1].h
    const currTop = sorted[i].y
    const gap = prevBottom - currTop
    if (gap > bestGap) {
      bestGap = gap
      bestSplit = (prevBottom + currTop) / 2
    }
  }
  return bestSplit
}

/** X축 분할점 찾기 — 수직 공백 밴드 중 가장 넓은 갭 */
function findXSplit(items: NormItem[], _region: TextRegion, gapThreshold: number): number | null {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  let bestGap = gapThreshold
  let bestSplit: number | null = null

  for (let i = 1; i < sorted.length; i++) {
    const prevRight = sorted[i - 1].x + sorted[i - 1].w
    const currLeft = sorted[i].x
    const gap = currLeft - prevRight
    if (gap > bestGap) {
      bestGap = gap
      bestSplit = (prevRight + currLeft) / 2
    }
  }
  return bestSplit
}

// ═══════════════════════════════════════════════════════
// 페이지 콘텐츠 추출 → IRBlock[] (v2: 바운딩 박스 + 페이지 번호)
// ═══════════════════════════════════════════════════════

/**
 * 선 기반 테이블 감지를 우선 시도, 실패 시 기존 휴리스틱 fallback.
 */
function extractPageBlocksWithLines(
  items: NormItem[],
  pageNum: number,
  opList: { fnArray: Uint32Array | number[]; argsArray: unknown[][] },
  pageWidth: number,
  pageHeight: number,
): IRBlock[] {
  if (items.length === 0) return []

  // 1단계: PDF 그래픽 명령에서 선 추출
  let { horizontals, verticals } = extractLines(opList.fnArray, opList.argsArray)
  ;({ horizontals, verticals } = filterPageBorderLines(horizontals, verticals, pageWidth, pageHeight))

  // 1.5단계: 선 전처리 (ODL LinesPreprocessingConsumer 포팅)
  // 굵은 선 필터 + 근접 평행 선 병합
  ;({ horizontals, verticals } = preprocessLines(horizontals, verticals))

  // 2단계: 선으로 테이블 그리드 구성
  const grids = buildTableGrids(horizontals, verticals)

  if (grids.length > 0) {
    return extractBlocksWithGrids(items, pageNum, grids, horizontals, verticals)
  }

  // Fallback: 기존 휴리스틱 (선이 없는 PDF)
  return extractPageBlocksFallback(items, pageNum)
}

/**
 * 선 기반 그리드가 감지된 경우: 테이블 영역의 텍스트는 셀에 매핑,
 * 나머지는 일반 텍스트 블록으로 처리.
 */
function extractBlocksWithGrids(
  items: NormItem[],
  pageNum: number,
  grids: TableGrid[],
  horizontals: import("./line-detector.js").LineSegment[],
  verticals: import("./line-detector.js").LineSegment[],
): IRBlock[] {
  const blocks: IRBlock[] = []
  const usedItems = new Set<NormItem>()

  // 그리드를 Y좌표 내림차순 정렬 (위→아래)
  const sortedGrids = [...grids].sort((a, b) => b.bbox.y2 - a.bbox.y2)

  for (const grid of sortedGrids) {
    // 1행 다열 그리드는 테이블 헤더일 가능성 높음 → 스킵하여 클러스터 감지에 위임
    const numGridRows = grid.rowYs.length - 1
    const numGridCols = grid.colXs.length - 1
    if (numGridRows === 1 && numGridCols >= 2) continue
    // 1열 다행 그리드 (세로선 없는 표) → 스킵하여 클러스터 감지로 열 추론 위임
    // Why: 행 구분선만 있는 표는 builder.ts 의 1-col branch 에서 세로 일렬로 플래튼되어
    //      테이블 구조가 무너짐. 클러스터 기반 X좌표 정렬로 열을 복원할 기회 제공.
    if (numGridCols === 1 && numGridRows >= 2) continue

    // 그리드 영역 내 텍스트 아이템 수집
    const tableItems: NormItem[] = []
    const pad = 3
    const gridW = grid.bbox.x2 - grid.bbox.x1
    for (const item of items) {
      if (usedItems.has(item)) continue
      // Y 범위 체크
      if (item.y < grid.bbox.y1 - pad || item.y > grid.bbox.y2 + pad) continue
      // X 범위 체크 — 아이템의 시작과 끝이 모두 그리드 안에 있어야 함
      if (item.x < grid.bbox.x1 - pad || item.x + item.w > grid.bbox.x2 + pad) continue
      // 좁은 그리드(120px 미만)에서 큰 아이템이 경계에 걸치면 제외
      // 제목 텍스트가 인접 그리드에 잡히는 것을 방지
      if (gridW < 120 && item.x + item.w > grid.bbox.x2 - 2) continue
      tableItems.push(item)
      usedItems.add(item)
    }

    // 셀 추출
    const cells = extractCells(grid, horizontals, verticals)
    if (cells.length === 0) continue

    // 텍스트→셀 매핑
    const textItems: TextItem[] = tableItems.map(i => ({
      text: i.text, x: i.x, y: i.y, w: i.w, h: i.h,
      fontSize: i.fontSize, fontName: i.fontName,
    }))
    const cellTextMap = mapTextToCells(textItems, cells)

    // IRTable 구성
    const numRows = grid.rowYs.length - 1
    const numCols = grid.colXs.length - 1
    const irGrid: import("../types.js").IRCell[][] = Array.from(
      { length: numRows },
      () => Array.from({ length: numCols }, () => ({ text: "", colSpan: 1, rowSpan: 1 })),
    )

    for (const cell of cells) {
      const cellItems = cellTextMap.get(cell) || []
      let text = cellTextToString(cellItems)
      // 셀 안의 페이지 번호 표시 제거 ("- 2 -" 등)
      text = text.replace(/^[\s]*[-–—]\s*\d+\s*[-–—][\s]*$/gm, "").trim()
      // 셀 텍스트 균등배분 공백 제거 ("경 제 총 괄 반" → "경제총괄반")
      text = text.split("\n").map(line => collapseEvenSpacing(line)).join("\n")
      irGrid[cell.row][cell.col] = {
        text,
        colSpan: cell.colSpan,
        rowSpan: cell.rowSpan,
      }
    }

    const irTable: IRTable = {
      rows: numRows,
      cols: numCols,
      cells: irGrid,
      hasHeader: numRows > 1,
    }

    // 빈 테이블(모든 셀이 빈 문자열) 스킵
    const hasContent = irGrid.some(row => row.some(cell => cell.text.trim() !== ""))
    if (!hasContent) continue

    const tableBbox: BoundingBox = {
      page: pageNum,
      x: grid.bbox.x1, y: grid.bbox.y1,
      width: grid.bbox.x2 - grid.bbox.x1, height: grid.bbox.y2 - grid.bbox.y1,
    }

    // 의사 테이블 필터: 텍스트성 내용 → paragraph로 복원 (구조 보존)
    if (shouldDemoteTable(irTable)) {
      const demoted = demoteTableToText(irTable)
      if (demoted) {
        // 텍스트 박스(1x1 또는 1행 그리드) demote 시 앞뒤 줄바꿈으로 본문과 분리
        const text = numGridRows === 1 ? "\n" + demoted + "\n" : demoted
        blocks.push({ type: "paragraph", text, pageNumber: pageNum, bbox: tableBbox, style: dominantStyle(tableItems) })
      }
      continue
    }

    blocks.push({ type: "table", table: irTable, pageNumber: pageNum, bbox: tableBbox })
  }

  // 테이블에 속하지 않은 나머지 텍스트 → 일반 블록
  let remaining = items.filter(i => !usedItems.has(i))
  if (remaining.length > 0) {
    remaining.sort((a, b) => b.y - a.y || a.x - b.x)

    // 클러스터 기반 테이블 감지 (XY-Cut 전에 실행 — 테이블이 쪼개지지 않도록)
    const clusterItems: ClusterItem[] = remaining.map(i => ({
      text: i.text, x: i.x, y: i.y, w: i.w, h: i.h,
      fontSize: i.fontSize, fontName: i.fontName,
    }))
    const clusterResults = detectClusterTables(clusterItems, pageNum)
    if (clusterResults.length > 0) {
      const ciToIdx = new Map<ClusterItem, number>()
      for (let ci = 0; ci < clusterItems.length; ci++) ciToIdx.set(clusterItems[ci], ci)
      const usedClusterIndices = new Set<number>()
      for (const cr of clusterResults) {
        for (const ci of cr.usedItems) {
          const idx = ciToIdx.get(ci)
          if (idx !== undefined) usedClusterIndices.add(idx)
        }
        blocks.push({ type: "table", table: cr.table, pageNumber: pageNum, bbox: cr.bbox })
      }
      remaining = remaining.filter((_, idx) => !usedClusterIndices.has(idx))
    }

    // XY-Cut으로 왼쪽 본문과 오른쪽 부서명 등을 분리 후 개별 처리
    if (remaining.length > 0) {
      const allY = remaining.map(i => i.y)
      const pageH = safeMax(allY) - safeMin(allY)
      const groups = xyCutOrder(remaining, Math.max(15, pageH * 0.03))
      const textBlocks: IRBlock[] = []
      for (const group of groups) {
        if (group.length === 0) continue
        const groupBlocks = extractPageBlocksFallback(group, pageNum)
        for (const b of groupBlocks) textBlocks.push(b)
      }
      const finalTextBlocks = detectListBlocks(textBlocks)
      for (const b of finalTextBlocks) blocks.push(b)
    }

    // Y좌표 기반 정렬
    blocks.sort((a, b) => {
      const ay = a.bbox ? (a.bbox.y + a.bbox.height) : 0
      const by = b.bbox ? (b.bbox.y + b.bbox.height) : 0
      return by - ay // PDF는 y가 위가 큼 → 내림차순
    })
    return mergeAdjacentTableBlocks(blocks)
  }

  return mergeAdjacentTableBlocks(blocks)
}

/** 같은 열 수의 연속 테이블 블록을 하나로 합침 */
function mergeAdjacentTableBlocks(blocks: IRBlock[]): IRBlock[] {
  if (blocks.length <= 1) return blocks
  const result: IRBlock[] = [blocks[0]]
  for (let i = 1; i < blocks.length; i++) {
    const prev = result[result.length - 1]
    const curr = blocks[i]
    if (prev.type === "table" && curr.type === "table" && prev.table && curr.table &&
        prev.table.cols === curr.table.cols) {
      // 합치기: prev의 cells에 curr의 cells 추가
      const merged: IRTable = {
        rows: prev.table.rows + curr.table.rows,
        cols: prev.table.cols,
        cells: [...prev.table.cells, ...curr.table.cells],
        hasHeader: prev.table.hasHeader,
      }
      result[result.length - 1] = { ...prev, table: merged }
    } else {
      result.push(curr)
    }
  }
  return result
}

/**
 * 기존 휴리스틱 기반 페이지 블록 추출 (선이 없는 PDF 대비 fallback).
 */
function extractPageBlocksFallback(items: NormItem[], pageNum: number): IRBlock[] {
  if (items.length === 0) return []

  const blocks: IRBlock[] = []

  // 1단계: 클러스터 기반 테이블 감지 우선 (헤더 감지 시 정확도 높음)
  const clusterItems: ClusterItem[] = items.map(i => ({
    text: i.text, x: i.x, y: i.y, w: i.w, h: i.h,
    fontSize: i.fontSize, fontName: i.fontName,
  }))
  const clusterResults = detectClusterTables(clusterItems, pageNum)

  if (clusterResults.length > 0) {
    const ciToIdx = new Map<ClusterItem, number>()
    for (let ci = 0; ci < clusterItems.length; ci++) ciToIdx.set(clusterItems[ci], ci)
    const usedIndices = new Set<number>()
    for (const cr of clusterResults) {
      for (const ci of cr.usedItems) {
        const idx = ciToIdx.get(ci)
        if (idx !== undefined) usedIndices.add(idx)
      }
      blocks.push({ type: "table", table: cr.table, pageNumber: pageNum, bbox: cr.bbox })
    }

    // 테이블에 속하지 않은 나머지 텍스트 → 일반 블록
    const remaining = items.filter((_, idx) => !usedIndices.has(idx))
    if (remaining.length > 0) {
      const yLines = groupByY(remaining)
      for (const line of yLines) {
        const text = mergeLineSimple(line)
        if (!text.trim()) continue
        const bbox = computeBBox(line, pageNum)
        blocks.push({ type: "paragraph", text, pageNumber: pageNum, bbox, style: dominantStyle(line) })
      }
    }

    blocks.sort((a, b) => {
      const ay = a.bbox ? (a.bbox.y + a.bbox.height) : 0
      const by = b.bbox ? (b.bbox.y + b.bbox.height) : 0
      return by - ay
    })
  } else {
    // 2단계: 레거시 컬럼 감지 (3+ 열)
    const allYLines = groupByY(items)
    const columns = detectColumns(allYLines)

    if (columns && columns.length >= 3) {
      const tableText = extractWithColumns(allYLines, columns)
      const bbox = computeBBox(items, pageNum)
      blocks.push({ type: "paragraph", text: tableText, pageNumber: pageNum, bbox, style: dominantStyle(items) })
    } else {
      // 3단계: XY-Cut으로 읽기 순서 결정
      const allY = items.map(i => i.y)
      const pageHeight = safeMax(allY) - safeMin(allY)
      const gapThreshold = Math.max(15, pageHeight * 0.03)

      const orderedGroups = xyCutOrder(items, gapThreshold)

      for (const group of orderedGroups) {
        if (group.length === 0) continue
        const yLines = groupByY(group)

        const groupColumns = detectColumns(yLines)
        if (groupColumns && groupColumns.length >= 3) {
          const tableText = extractWithColumns(yLines, groupColumns)
          const bbox = computeBBox(group, pageNum)
          blocks.push({ type: "paragraph", text: tableText, pageNumber: pageNum, bbox, style: dominantStyle(group) })
        } else {
          for (const line of yLines) {
            const text = mergeLineSimple(line)
            if (!text.trim()) continue
            const bbox = computeBBox(line, pageNum)
            blocks.push({ type: "paragraph", text, pageNumber: pageNum, bbox, style: dominantStyle(line) })
          }
        }
      }
    }
  }

  // 한국어 특수 테이블 감지 (구분/항목/종류 패턴)
  return detectSpecialKoreanTables(blocks)
}

/** 아이템 그룹에서 바운딩 박스 계산 */
function computeBBox(items: NormItem[], pageNum: number): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const i of items) {
    if (i.x < minX) minX = i.x
    if (i.y < minY) minY = i.y
    if (i.x + i.w > maxX) maxX = i.x + i.w
    // h가 0인 경우 fontSize를 높이 대용으로 사용 (pdfjs가 height를 제공하지 않는 경우)
    const effectiveH = i.h > 0 ? i.h : i.fontSize
    if (i.y + effectiveH > maxY) maxY = i.y + effectiveH
  }
  return { page: pageNum, x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** 아이템 그룹의 대표 스타일 (최빈 폰트 크기) */
function dominantStyle(items: NormItem[]): { fontSize: number; fontName: string } | undefined {
  if (items.length === 0) return undefined
  // 최빈 폰트 크기 찾기
  const freq = new Map<number, number>()
  let maxCount = 0, dominantSize = 0
  for (const i of items) {
    if (i.fontSize <= 0) continue
    const count = (freq.get(i.fontSize) || 0) + 1
    freq.set(i.fontSize, count)
    if (count > maxCount) { maxCount = count; dominantSize = i.fontSize }
  }
  if (dominantSize === 0) return undefined
  // 대표 폰트명 (빈 문자열은 undefined로)
  const fontName = items.find(i => i.fontSize === dominantSize)?.fontName || undefined
  return { fontSize: dominantSize, fontName }
}

function normalizeItems(rawItems: PdfTextItem[]): NormItem[] {
  const items: NormItem[] = []
  // pdfjs 공백 아이템 위치 수집 — 단어 경계 힌트로 활용
  const spacePositions: { x: number; y: number }[] = []

  for (const i of rawItems) {
    if (typeof i.str !== "string") continue
    const x = Math.round(i.transform[4])
    const y = Math.round(i.transform[5])

    if (!i.str.trim()) {
      // 공백 전용 아이템: 위치만 기록 (단어 구분 힌트)
      spacePositions.push({ x, y })
      continue
    }

    const scaleY = Math.abs(i.transform[3])
    const scaleX = Math.abs(i.transform[0])
    const fontSize = Math.round(Math.max(scaleY, scaleX))
    const w = Math.round(i.width)
    const h = Math.round(i.height)
    const isHidden = fontSize === 0 || (i.width === 0 && i.str.trim().length > 0)

    // letterSpacing이 적용된 숫자/기호 문자열 정규화
    // "45 0 -7 3 40 )" → "450-7340)" (전화번호, 금액 등)
    let text = i.str.trim()
    if (/^[\d\s\-().·,☎]+$/.test(text) && /\d/.test(text) && / /.test(text)) {
      text = text.replace(/ /g, "")
    }

    // 균등배분 TextItem 분해: "홍 보 지 원 반" → 개별 글자 아이템으로
    const split = splitEvenSpacedItem(text, x, w, fontSize)
    if (split) {
      for (const s of split) {
        items.push({ text: s.text, x: s.x, y, w: s.w, h, fontSize, fontName: i.fontName || "", isHidden })
      }
    } else {
      items.push({ text, x, y, w, h, fontSize, fontName: i.fontName || "", isHidden })
    }
  }

  const sorted = items.sort((a, b) => b.y - a.y || a.x - b.x)

  // 1. 가짜 볼드 중복 제거: 같은 텍스트가 거의 동일한 좌표(±3px)에 2~3회 겹쳐진 경우
  // PDF에서 볼드 효과를 위해 텍스트를 여러 번 렌더링하는 기법
  const deduped: NormItem[] = []
  for (let i = 0; i < sorted.length; i++) {
    let isDup = false
    // Y 정렬(desc)이므로 역순 스캔 — Y 차이가 tolerance를 넘으면 중단
    for (let j = deduped.length - 1; j >= 0; j--) {
      const prev = deduped[j]
      if (prev.y - sorted[i].y > 3) break // 이전 아이템이 너무 높음 → 중단
      if (Math.abs(prev.y - sorted[i].y) <= 3 &&
          prev.text === sorted[i].text && Math.abs(prev.x - sorted[i].x) <= 3) {
        isDup = true
        break
      }
    }
    if (!isDup) deduped.push(sorted[i])
  }

  // 2. 공백 아이템 위치를 NormItem.hasSpaceBefore로 전파
  // 같은 Y라인(±3px)에서 공백 아이템의 x가 현재 아이템 직전(왼쪽)에 있으면 표시
  if (spacePositions.length > 0) {
    for (const item of deduped) {
      for (const sp of spacePositions) {
        // 같은 Y라인(±3px) + 공백이 아이템 왼쪽에 인접 (0 ~ 20px 이내)
        if (Math.abs(sp.y - item.y) <= 3) {
          const dist = item.x - sp.x
          if (dist >= 0 && dist <= 20) {
            item.hasSpaceBefore = true
            break
          }
        }
      }
    }
  }

  return deduped
}

/**
 * 균등배분 TextItem 감지 및 분해.
 * "홍 보 지 원 반" (1자+공백 패턴) → [{text:"홍",x,w}, {text:"보",x,w}, ...]
 * 분해하면 이후 detectEvenSpacedItems가 좌표 기반으로 정확히 감지할 수 있음.
 */
function splitEvenSpacedItem(
  text: string, itemX: number, itemW: number, fontSize: number,
): { text: string; x: number; w: number }[] | null {
  // 한글/숫자 1자 + 공백이 3회+ 반복되는 패턴
  // "홍 보 지 원 반", "세 무 1 과", "주 요 내 용"
  if (!/^[가-힣\d](?: [가-힣\d]){2,}$/.test(text)) return null

  const chars = text.split(" ")
  if (chars.length < 3) return null

  // 글자당 폭 계산 — 전체 width를 글자 수로 나눔
  const charW = itemW / chars.length
  // 글자 폭이 너무 크면 균등배분이 아님 (한 글자가 fontSize의 2배 넘으면 이상)
  if (charW > fontSize * 2) return null

  return chars.map((ch, idx) => ({
    text: ch,
    x: Math.round(itemX + idx * charW),
    w: Math.round(charW * 0.8), // 실제 글자 폭은 간격보다 좁음
  }))
}

function groupByY(items: NormItem[]): NormItem[][] {
  if (items.length === 0) return []
  const lines: NormItem[][] = []
  let curY = items[0].y
  let curLine: NormItem[] = [items[0]]

  for (let i = 1; i < items.length; i++) {
    // Y좌표 허용 오차 3px — PDF 렌더링 미세 오차 보정, 별표 행 경계 감지에 최적화된 값
    if (Math.abs(items[i].y - curY) > 3) {
      lines.push(curLine)
      curLine = []
      curY = items[i].y
    }
    curLine.push(items[i])
  }
  if (curLine.length > 0) lines.push(curLine)
  return lines
}

// ═══════════════════════════════════════════════════════
// 열 경계 감지 — 빈도 기반 x-히스토그램 클러스터링
// ═══════════════════════════════════════════════════════

/** prose 라인 판별: 아이템 간 gap이 모두 작으면 문장 (단어 나열) */
function isProseSpread(items: NormItem[]): boolean {
  if (items.length < 4) return false
  const sorted = [...items].sort((a, b) => a.x - b.x)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w))
  }
  // gap의 최대값이 작고 평균 단어 길이가 짧으면 prose
  const maxGap = safeMax(gaps)
  const avgLen = items.reduce((s, i) => s + i.text.length, 0) / items.length
  // 짧은 단어들이 좁은 간격으로 나열 = prose (예: "위 표 제3호나목에서 남은 유효기간...")
  return maxGap < 40 && avgLen < 5
}

function detectColumns(yLines: NormItem[][]): number[] | null {
  const allItems = yLines.flat()
  if (allItems.length === 0) return null
  const pageWidth = safeMax(allItems.map(i => i.x + i.w)) - safeMin(allItems.map(i => i.x))
  if (pageWidth < 100) return null

  // "비고" 이전 아이템만 사용 (비고 이후는 prose)
  let bigoLineIdx = -1
  for (let i = 0; i < yLines.length; i++) {
    if (yLines[i].length <= 2 && yLines[i].some(item => item.text === "비고")) {
      bigoLineIdx = i
      break
    }
  }
  const tableYLines = bigoLineIdx >= 0 ? yLines.slice(0, bigoLineIdx) : yLines

  // Step 1: 모든 아이템의 x를 수집 (prose 라인 제외)
  // CLUSTER_TOL 22px — 한국 공문서 PDF 열 간격에 최적화, 별표 표 열 감지 핵심값
  const CLUSTER_TOL = 22
  const xClusters: { center: number; count: number; minX: number }[] = []

  for (const line of tableYLines) {
    if (isProseSpread(line)) continue
    for (const item of line) {
      let found = false
      for (const c of xClusters) {
        if (Math.abs(item.x - c.center) <= CLUSTER_TOL) {
          c.center = Math.round((c.center * c.count + item.x) / (c.count + 1))
          c.minX = Math.min(c.minX, item.x)
          c.count++
          found = true
          break
        }
      }
      if (!found) {
        xClusters.push({ center: item.x, count: 1, minX: item.x })
      }
    }
  }

  // Step 2: 빈도 피크 — 최소 3회 이상 등장 (단발성 텍스트 노이즈 제거)
  const peaks = xClusters
    .filter(c => c.count >= 3)
    .sort((a, b) => a.minX - b.minX)

  // 최소 3개 열이 있어야 테이블로 판별 — 2열은 일반 2단 레이아웃과 구분 불가
  if (peaks.length < 3) return null

  // Step 3: 가까운 피크 병합 — MERGE_TOL 40px (같은 논리 열의 미세 위치 차이 흡수)
  const MERGE_TOL = 40
  const merged: { center: number; count: number; minX: number }[] = [peaks[0]]
  for (let i = 1; i < peaks.length; i++) {
    const prev = merged[merged.length - 1]
    if (peaks[i].minX - prev.minX < MERGE_TOL) {
      // 빈도 높은 쪽 유지, 최소 x는 작은 값
      if (peaks[i].count > prev.count) {
        prev.center = peaks[i].center
      }
      prev.count += peaks[i].count
      prev.minX = Math.min(prev.minX, peaks[i].minX)
    } else {
      merged.push({ ...peaks[i] })
    }
  }

  // 열 경계 = 각 클러스터의 minX (왼쪽 정렬 기준), 병합 후 재검증
  const rawColumns = merged.filter(c => c.count >= 3).map(c => c.minX)
  if (rawColumns.length < 3) return null

  // 최소 열 폭 검증: 30px 미만인 열은 인접 열과 병합 (한 글자 열 방지)
  const MIN_DETECT_COL_WIDTH = 30
  const columns: number[] = [rawColumns[0]]
  for (let i = 1; i < rawColumns.length; i++) {
    if (rawColumns[i] - columns[columns.length - 1] < MIN_DETECT_COL_WIDTH) continue
    columns.push(rawColumns[i])
  }
  return columns.length >= 3 ? columns : null
}

function findColumn(x: number, columns: number[]): number {
  for (let i = columns.length - 1; i >= 0; i--) {
    // 10px 왼쪽 허용 오차 — 셀 내 텍스트 미세 좌측 이탈 보정
    if (x >= columns[i] - 10) return i
  }
  return 0
}

// ═══════════════════════════════════════════════════════
// 열 기반 추출 — 테이블/텍스트 영역 분리
// ═══════════════════════════════════════════════════════

function extractWithColumns(yLines: NormItem[][], columns: number[]): string {
  const result: string[] = []
  const colMin = columns[0]
  const colMax = columns[columns.length - 1]

  // "비고" 라인 감지 — 이후는 텍스트로 처리
  let bigoIdx = -1
  for (let i = 0; i < yLines.length; i++) {
    if (yLines[i].length <= 2 && yLines[i].some(item => item.text === "비고")) {
      bigoIdx = i
      break
    }
  }

  // 테이블 시작: 첫 번째 다열(3+ 열 사용) 라인
  let tableStart = -1
  for (let i = 0; i < (bigoIdx >= 0 ? bigoIdx : yLines.length); i++) {
    const usedCols = new Set(yLines[i].map(item => findColumn(item.x, columns)))
    if (usedCols.size >= 3) {
      tableStart = i
      break
    }
  }

  const tableEnd = bigoIdx >= 0 ? bigoIdx : yLines.length

  // 테이블 시작 이전 = 텍스트
  for (let i = 0; i < (tableStart >= 0 ? tableStart : tableEnd); i++) {
    result.push(mergeLineSimple(yLines[i]))
  }

  // 테이블 영역: 모든 라인을 그리드에 포함 (단일 아이템 라인도)
  if (tableStart >= 0) {
    const tableLines = yLines.slice(tableStart, tableEnd)
    // 테이블 x범위 밖의 라인만 텍스트로 분리
    // 좌측 20px, 우측 200px 허용 — 비고/주석 열이 오른쪽에 넓게 위치하는 공문서 특성 반영
    const gridLines: NormItem[][] = []
    for (const line of tableLines) {
      const inRange = line.some(item =>
        item.x >= colMin - 20 && item.x <= colMax + 200
      )
      if (inRange && !isProseSpread(line)) {
        gridLines.push(line)
      } else {
        // 그리드 밖 라인은 현재까지 축적된 그리드 출력 후 텍스트로
        if (gridLines.length > 0) {
          result.push(buildGridTable(gridLines.splice(0), columns))
        }
        result.push(mergeLineSimple(line))
      }
    }
    if (gridLines.length > 0) {
      result.push(buildGridTable(gridLines, columns))
    }
  }

  // 비고 영역
  if (bigoIdx >= 0) {
    result.push("")
    for (let i = bigoIdx; i < yLines.length; i++) {
      result.push(mergeLineSimple(yLines[i]))
    }
  }

  return result.join("\n")
}

// ═══════════════════════════════════════════════════════
// 그리드 테이블 빌더 — y-라인을 열에 배치 후 행 병합
// ═══════════════════════════════════════════════════════

function buildGridTable(lines: NormItem[][], columns: number[]): string {
  const numCols = columns.length

  // Step 1: 각 y-라인을 열에 배치
  const yRows: string[][] = lines.map(items => {
    const row = Array(numCols).fill("")
    for (const item of items) {
      const col = findColumn(item.x, columns)
      row[col] = row[col] ? row[col] + " " + item.text : item.text
    }
    return row
  })

  // Step 2: 행 병합 — 새 논리적 행 판별
  // 데이터 열 기준점 (가격 등이 들어가는 오른쪽 열들)
  const dataColStart = Math.max(2, Math.floor(numCols / 2))
  const merged: string[][] = []

  for (const row of yRows) {
    if (row.every(c => c === "")) continue

    if (merged.length === 0) {
      merged.push([...row])
      continue
    }

    const prev = merged[merged.length - 1]
    const filledCols = row.map((c, i) => c ? i : -1).filter(i => i >= 0)
    const filledCount = filledCols.length

    let isNewRow = false

    // Rule 1: col 0에 텍스트 (3글자 이상) → 새 행 (단, "권"처럼 짧은 건 continuation)
    if (row[0] && row[0].length >= 3) {
      isNewRow = true
    }

    // Rule 2: col 1에 텍스트 → 항상 새 행 (새 항목 시작)
    if (!isNewRow && numCols > 1 && row[1]) {
      isNewRow = true
    }

    // Rule 3: 데이터 열(3+)에 새 값이 있고 이전 행 데이터 열에도 이미 값 있음 → 새 가격 행
    if (!isNewRow) {
      const hasData = row.slice(dataColStart).some(c => c !== "")
      const prevHasData = prev.slice(dataColStart).some(c => c !== "")
      if (hasData && prevHasData) {
        isNewRow = true
      }
    }

    // Exception: filledCount=1이고 col 0에 짧은 텍스트(≤2자) → word continuation (예: "권", "여권")
    if (isNewRow && filledCount === 1 && row[0] && row[0].length <= 2) {
      isNewRow = false
    }

    if (isNewRow) {
      merged.push([...row])
    } else {
      for (let c = 0; c < numCols; c++) {
        if (row[c]) {
          prev[c] = prev[c] ? prev[c] + " " + row[c] : row[c]
        }
      }
    }
  }

  if (merged.length < 2) {
    return merged.map(r => r.filter(c => c).join(" ")).join("\n")
  }

  // Step 3: 헤더 행 병합 — 첫 N행이 모두 데이터열(dataColStart+)에 값이 없으면 헤더
  let headerEnd = 0
  for (let r = 0; r < merged.length; r++) {
    const hasDataValues = merged[r].slice(dataColStart).some(c => c && /\d/.test(c))
    if (hasDataValues) break
    headerEnd = r + 1
  }

  if (headerEnd > 1) {
    // 헤더 행들을 하나로 합침
    const headerRow = Array(numCols).fill("")
    for (let r = 0; r < headerEnd; r++) {
      for (let c = 0; c < numCols; c++) {
        if (merged[r][c]) {
          headerRow[c] = headerRow[c] ? headerRow[c] + " " + merged[r][c] : merged[r][c]
        }
      }
    }
    merged.splice(0, headerEnd, headerRow)
  }

  // Step 3.5: 셀 텍스트 균등배분 공백 제거 ("경 제 총 괄 반" → "경제총괄반")
  for (const row of merged) {
    for (let c = 0; c < row.length; c++) {
      if (row[c]) row[c] = collapseEvenSpacing(row[c])
    }
  }

  // Step 3.6: 테이블 품질 검증 — 선 없는 fallback 경로에서는 보수적으로
  const totalCells = merged.length * numCols
  const filledCells = merged.reduce((s, row) => s + row.filter(c => c).length, 0)
  // 빈 셀 과반, 행이 2 미만, 또는 3행 이하+7열 이상 → 텍스트로 복원
  if (filledCells < totalCells * 0.35 || merged.length < 2 ||
      (merged.length <= 3 && numCols >= 7)) {
    return merged.map(r => r.filter(c => c).join("\t")).join("\n")
  }

  // Step 4: 마크다운 테이블
  const md: string[] = []
  md.push("| " + merged[0].join(" | ") + " |")
  md.push("| " + merged[0].map(() => "---").join(" | ") + " |")
  for (let r = 1; r < merged.length; r++) {
    md.push("| " + merged[r].join(" | ") + " |")
  }
  return md.join("\n")
}

// ═══════════════════════════════════════════════════════
// 유틸
// ═══════════════════════════════════════════════════════

function mergeLineSimple(items: NormItem[]): string {
  if (items.length <= 1) return items[0]?.text || ""
  const sorted = [...items].sort((a, b) => a.x - b.x)

  // 좌표 기반 균등배분 감지 (ODL TextLineProcessor 방식)
  const isEvenSpaced = detectEvenSpacedItems(sorted)

  let result = sorted[0].text
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w)
    const avgFs = (sorted[i].fontSize + sorted[i - 1].fontSize) / 2

    // 탭 갭은 항상 탭으로 — 균등배분보다 우선
    // 기준: fontSize의 2배 이상 또는 30px+ (균등배분 간격은 보통 fontSize*1.5 이하)
    const tabThreshold = Math.max(avgFs * 2, 30)
    if (gap > tabThreshold) {
      result += "\t"
      result += sorted[i].text
      continue
    }

    // 균등배분 구간이면 공백 없이 합침
    if (isEvenSpaced[i]) {
      result += sorted[i].text
      continue
    }

    // pdfjs 공백 아이템이 있었으면 단어 경계 — 갭 크기 무관하게 공백 삽입
    if (sorted[i].hasSpaceBefore && gap >= avgFs * 0.05) {
      result += " "
      result += sorted[i].text
      continue
    }
    // 마커(□○▶ 등) 뒤에 한글이 오면 항상 공백 보장 — "□장소" → "□ 장소"
    if (/[□■○●▶◆◇ㅇ]$/.test(sorted[i - 1].text) && /^[가-힣]/.test(sorted[i].text) && gap > 1) {
      result += " "
      result += sorted[i].text
      continue
    }
    // 매우 작은 갭 — 공백 없이 붙임
    if (gap < avgFs * 0.15) { /* no space */ }
    // 한글 관련 작은 갭 — PDF 문자 개별 배치 잔재
    else if (gap < avgFs * 0.35 && (/[가-힣]$/.test(result) || /^[가-힣]/.test(sorted[i].text))) { /* no space */ }
    // 3px+ 갭 = 공백 (단어 구분)
    else if (gap > 3) result += " "
    result += sorted[i].text
  }
  return result
}




/** 블록 트리의 텍스트에서 비표시 제어문자를 in-place로 제거한다. */
function sanitizeBlockControlChars(blocks: IRBlock[]): void {
  for (const b of blocks) {
    if (b.text) b.text = stripControlChars(b.text)
    if (b.table) {
      for (const row of b.table.cells) {
        for (const cell of row) {
          if (cell.text) cell.text = stripControlChars(cell.text)
        }
      }
    }
    if (b.children) sanitizeBlockControlChars(b.children)
  }
}

export function cleanPdfText(text: string): string {
  return mergeKoreanLines(
    stripControlChars(text)
      // 문서 시작 단독 페이지 번호
      .replace(/^\d{1,4}\n/, "")
      // "- 2 -" 스타일 페이지 번호 (독립 라인 및 목록 항목 형태 포함)
      .replace(/^[\s]*[-–—]\s*[-–—]?\d+[-–—]?[\s]*[-–—]?[\s]*$/gm, "")
      // "1 / 5" 스타일 페이지 번호
      .replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, "")
      // 단독 페이지 번호 (줄 끝에 혼자 있는 숫자)
      .replace(/\n\d{1,4}\n/g, "\n")
      // 문서 마지막 단독 페이지 번호
      .replace(/\n\d{1,4}$/, "")
      // 단독 숫자 헤딩 제거 ("# 6\n재무과" → "\n재무과")
      .replace(/^#{1,6}\s*\d{1,4}\s*$/gm, "")
  )
    // 균등배분 문자열 후처리 (pdfjs가 합친 TextItem + buildGridTable 셀 텍스트)
    // LaTeX 수식 라인 ($...$ / $$...$$) 은 공백이 토큰 구분자라 collapse 시 `\cdot d` → `\cdotd` 로 망가짐 — skip
    .replace(/^(?!\| ---).*$/gm, line => {
      if (/^\s*\${1,2}.+\${1,2}\s*$/.test(line)) return line
      return collapseEvenSpacing(line)
    })
    // 마커 뒤 2글자 균등배분 합침 ("□ 일 시" → "□ 일시", "□ 장 소" → "□ 장소")
    .replace(/([□■◆○●▶ㅇ])\s+([가-힣])\s+([가-힣])/g, "$1 $2$3")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function startsWithMarker(line: string): boolean {
  const t = line.trimStart()
  return /^[가-힣ㄱ-ㅎ][.)]/.test(t) || /^\d+[.)]/.test(t) || /^\([가-힣ㄱ-ㅎ\d]+\)/.test(t) ||
    /^[○●※▶▷◆◇■□★☆\-·]\s/.test(t) || /^제\d+[조항호장절]/.test(t)
}

function isStandaloneHeader(line: string): boolean {
  return /^제\d+[조항호장절](\([^)]*\))?(\s+\S+){0,7}$/.test(line.trim())
}

// ═══════════════════════════════════════════════════════
// 리스트 감지 — paragraph 블록 중 번호 패턴을 list 블록으로 변환
// ═══════════════════════════════════════════════════════

/**
 * 연속된 paragraph 블록에서 번호 리스트 패턴을 감지하여 list 블록으로 변환.
 * "비고" 헤더 뒤에 오는 "1.", "2." 패턴이 대표적.
 */
function detectListBlocks(blocks: IRBlock[]): IRBlock[] {
  const result: IRBlock[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === "paragraph" && block.text) {
      const text = block.text.trim()
      // 번호 리스트: "1.", "2." 등
      if (/^\d+\.\s/.test(text)) {
        result.push({ ...block, type: "list", listType: "ordered", text: block.text })
        continue
      }
      // 비번호 리스트: ○, -, ·, ※, ▶ 등
      if (/^[○●·※▶▷◆◇\-]\s/.test(text)) {
        result.push({ ...block, type: "list", listType: "unordered", text: block.text })
        continue
      }
    }

    result.push(block)
  }

  return result
}

// ═══════════════════════════════════════════════════════
// 한국어 특수 테이블 감지 — "구분/항목/종류" 패턴 기반 key-value 테이블
// ═══════════════════════════════════════════════════════

/**
 * ODL SpecialTableProcessor 포팅: 연속된 "구분:", "항목:", "종류:" 등
 * 한국어 key-value 패턴을 2열 테이블로 변환.
 *
 * 동작:
 * 1) paragraph 블록의 텍스트에서 한국어 key-value 패턴 감지
 * 2) ":"가 있으면 key | value 2열, 없으면 colSpan=2 (전체 행)
 * 3) 연속된 패턴을 하나의 테이블로 그룹화
 */
const KOREAN_TABLE_HEADER_RE = /^\(?(구분|항목|종류|분류|유형|대상|내용|기간|금액|비율|방법|절차|요건|조건|근거|목적|범위|기준)\)?[:\s]/

/** KV 오탐 패턴: 시간(14:30), URL(://), 숫자:숫자(3:2) */
const KV_FALSE_POSITIVE_RE = /\d{1,2}:\d{2}|:\/\/|\d+:\d+/

function detectSpecialKoreanTables(blocks: IRBlock[]): IRBlock[] {
  const result: IRBlock[] = []
  let kvLines: { key: string; value: string; block: IRBlock }[] = []

  const flushKvTable = () => {
    if (kvLines.length < 2) {
      // 2행 미만이면 테이블로 만들 가치 없음 → 원래 블록 복원
      for (const kv of kvLines) result.push(kv.block)
      kvLines = []
      return
    }

    // 2열 테이블 생성
    const cells: import("../types.js").IRCell[][] = kvLines.map(kv => {
      if (kv.value) {
        return [
          { text: kv.key, colSpan: 1, rowSpan: 1 },
          { text: kv.value, colSpan: 1, rowSpan: 1 },
        ]
      }
      // ":" 없는 줄 → 전체 행 (colSpan=2)
      return [
        { text: kv.key, colSpan: 2, rowSpan: 1 },
        { text: "", colSpan: 1, rowSpan: 1 },
      ]
    })

    const irTable: IRTable = {
      rows: cells.length,
      cols: 2,
      cells,
      hasHeader: true,
    }

    // 첫 블록의 위치 정보 사용
    const firstBlock = kvLines[0].block
    result.push({
      type: "table",
      table: irTable,
      pageNumber: firstBlock.pageNumber,
      bbox: firstBlock.bbox,
    })
    kvLines = []
  }

  for (const block of blocks) {
    if (block.type !== "paragraph" || !block.text) {
      flushKvTable()
      result.push(block)
      continue
    }

    const text = block.text.trim()

    // "구분: xxx" 또는 "항목: xxx" 패턴 매칭
    if (KOREAN_TABLE_HEADER_RE.test(text)) {
      const colonIdx = text.indexOf(":")
      if (colonIdx >= 0) {
        kvLines.push({
          key: text.slice(0, colonIdx).trim(),
          value: text.slice(colonIdx + 1).trim(),
          block,
        })
      } else {
        // ":" 없이 공백으로 구분된 경우: "구분 xxx"
        const spaceIdx = text.search(/\s/)
        if (spaceIdx > 0) {
          kvLines.push({
            key: text.slice(0, spaceIdx).trim(),
            value: text.slice(spaceIdx + 1).trim(),
            block,
          })
        } else {
          kvLines.push({ key: text, value: "", block })
        }
      }
      continue
    }

    // key-value 패턴이 아닌 블록이 나오면 축적된 것을 flush
    // 단, 이미 수집 중이고 현재 블록이 "label: value" 형태면 계속 수집
    if (kvLines.length > 0 && text.includes(":")) {
      // 오탐 제외: 시간(14:30), URL(http://), 숫자:숫자(3:2), 괄호 포함
      if (!KV_FALSE_POSITIVE_RE.test(text) && !text.includes("(") && !text.includes(")")) {
        const colonIdx = text.indexOf(":")
        const key = text.slice(0, colonIdx).trim()
        // key가 순수 한글 2~8자 (공백/괄호 없음)면 유효한 key-value 라인
        if (/^[가-힣]+$/.test(key) && key.length >= 2 && key.length <= 8) {
          kvLines.push({
            key,
            value: text.slice(colonIdx + 1).trim(),
            block,
          })
          continue
        }
      }
    }

    flushKvTable()
    result.push(block)
  }

  flushKvTable()
  return result
}

// ─── 머리글/바닥글 감지 ────────────────────────────

/**
 * 머리글/바닥글 감지 — 2-pass 하이브리드:
 *  1) 텍스트 반복 패턴 (숫자 normalization) — 고정 문구
 *  2) y 위치 클러스터 (±3pt) — 텍스트가 페이지별로 달라도(챕터명 등) 위치가 반복되면 제거
 */
function removeHeaderFooterBlocks(
  blocks: IRBlock[],
  pageHeights: Map<number, number>,
  warnings: ParseWarning[],
): number[] {
  const ZONE_RATIO = 0.12   // 상하 12% (10% 초과 여백 대응)
  const MIN_REPEAT = 3       // 최소 3페이지 반복
  const Y_BUCKET = 5         // y 좌표 클러스터링 버킷 (pt)

  type ZoneEntry = { blockIdx: number; page: number; y: number; text: string }
  const topEntries: ZoneEntry[] = []
  const bottomEntries: ZoneEntry[] = []

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]
    if (!b.bbox || !b.pageNumber || !b.text?.trim()) continue
    const ph = pageHeights.get(b.bbox.page) || pageHeights.get(b.pageNumber)
    if (!ph) continue

    const blockTop = ph - (b.bbox.y + b.bbox.height)
    const blockBottom = ph - b.bbox.y
    const entry: ZoneEntry = { blockIdx: bi, page: b.pageNumber, y: b.bbox.y, text: b.text.trim() }

    if (blockBottom <= ph * ZONE_RATIO) bottomEntries.push(entry)
    else if (blockTop >= ph * (1 - ZONE_RATIO)) topEntries.push(entry)
  }

  const removeSet = new Set<number>()

  for (const entries of [topEntries, bottomEntries]) {
    if (entries.length === 0) continue

    // (1) 텍스트 반복 패턴
    const patternCount = new Map<string, number>()
    const patternPages = new Map<string, Set<number>>()
    for (const e of entries) {
      const norm = e.text.replace(/\d+/g, "#")
      patternCount.set(norm, (patternCount.get(norm) || 0) + 1)
      const pages = patternPages.get(norm) || new Set<number>()
      pages.add(e.page)
      patternPages.set(norm, pages)
    }
    const repeatedPatterns = new Set<string>()
    for (const [p, count] of patternCount) {
      // 서로 다른 페이지에서 MIN_REPEAT번 이상 등장
      if (count >= MIN_REPEAT && (patternPages.get(p)?.size ?? 0) >= MIN_REPEAT) {
        repeatedPatterns.add(p)
      }
    }

    // (2) y 위치 클러스터 — bucket별 등장 페이지 수
    const bucketPages = new Map<number, Set<number>>()
    for (const e of entries) {
      const bucket = Math.round(e.y / Y_BUCKET)
      const pages = bucketPages.get(bucket) || new Set<number>()
      pages.add(e.page)
      bucketPages.set(bucket, pages)
    }
    const repeatedBuckets = new Set<number>()
    for (const [b, pages] of bucketPages) {
      if (pages.size >= MIN_REPEAT) repeatedBuckets.add(b)
    }

    // 제거 대상: 텍스트 반복 OR 위치 반복
    for (const e of entries) {
      const norm = e.text.replace(/\d+/g, "#")
      const bucket = Math.round(e.y / Y_BUCKET)
      if (repeatedPatterns.has(norm) || repeatedBuckets.has(bucket)) {
        removeSet.add(e.blockIdx)
      }
    }
  }

  if (removeSet.size > 0) {
    warnings.push({ message: `${removeSet.size}개 머리글/바닥글 요소 제거됨`, code: "HIDDEN_TEXT_FILTERED" })
  }

  return [...removeSet].sort((a, b) => a - b)
}

function mergeKoreanLines(text: string): string {
  if (!text) return ""
  const lines = text.split("\n")
  if (lines.length <= 1) return text
  const result: string[] = [lines[0]]

  for (let i = 1; i < lines.length; i++) {
    const prev = result[result.length - 1]
    const curr = lines[i]
    const currTrimmed = curr.trim()
    // 마크다운 헤딩/테이블/구분선은 병합하지 않음
    if (/^#{1,6}\s/.test(prev) || /^#{1,6}\s/.test(curr) || /^\|/.test(currTrimmed) || /^---/.test(currTrimmed)) {
      result.push(curr)
      continue
    }
    // 쉼표로 끝나는 줄 + 다음 줄 = 연속 문장
    if (/,$/.test(prev.trim()) && currTrimmed.length > 0) {
      result[result.length - 1] = prev + "\n" + curr
      continue
    }
    // (※ 로 시작하는 줄 = 이전 줄의 부연설명
    if (/^\(※/.test(currTrimmed)) {
      result[result.length - 1] = prev + " " + currTrimmed
      continue
    }
    // 한글 줄바꿈 병합 — 마커(○, □ 등)로 시작하는 이전 줄은 합치지 않음
    if (/[가-힣·,\-]$/.test(prev) && /^[가-힣(]/.test(curr) &&
        !startsWithMarker(curr) && !isStandaloneHeader(prev) &&
        !startsWithMarker(prev)) {
      result[result.length - 1] = prev + " " + curr
    } else {
      result.push(curr)
    }
  }
  return result.join("\n")
}

// ═══════════════════════════════════════════════════════
// 수식 OCR 통합 (optional)
// ═══════════════════════════════════════════════════════

/**
 * 수식 OCR 을 적용하여 blocks 에 formula paragraph 를 삽입한다.
 *
 * 좌표 매핑:
 *   - pdfium 픽셀 bbox (top-left origin) → PDF 포인트 (bottom-left origin) 변환
 *   - 수식 bbox 의 y center 와 같은 페이지 내 pdfjs block 의 y center 비교로 삽입 위치 결정
 *   - pdfjs 가 이미 뽑은 수식 흔적(block) 과 겹치면 해당 block 제거 (중복 방지)
 *
 * 실패/trivial 수식(latex === "") 은 삽입하지 않는다.
 */
async function applyFormulaOcr(
  buffer: ArrayBuffer,
  blocks: IRBlock[],
  pageFilter: Set<number> | null,
  effectivePageCount: number,
  warnings: ParseWarning[],
  _onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const formulaMod = await import("./formula/index.js")
  const { FormulaPipeline, ensureFormulaModels } = formulaMod

  // 모델 준비 — 없으면 자동 다운로드. 진행률은 stderr 로 출력.
  await ensureFormulaModels((p) => {
    if (p.phase === "download" && p.total) {
      const pct = Math.floor((p.downloaded / p.total) * 100)
      process.stderr.write(`\r[kordoc-formula] ${p.spec.name} ${pct}% (${formatMb(p.downloaded)}/${formatMb(p.total)})`)
      if (p.downloaded >= p.total) process.stderr.write("\n")
    } else if (p.phase === "verify") {
      process.stderr.write(`[kordoc-formula] ${p.spec.name} SHA-256 검증 중...\n`)
    } else if (p.phase === "done") {
      process.stderr.write(`[kordoc-formula] ${p.spec.name} 준비 완료\n`)
    } else if (p.phase === "skip") {
      // 조용히 스킵
    }
  })

  const pipeline = await FormulaPipeline.create()
  try {
    const pagesResult = await pipeline.runOnBuffer(buffer, pageFilter)

    if (pagesResult.length === 0) return

    let insertedCount = 0
    let removedDupCount = 0

    for (const page of pagesResult) {
      const pageNumber = page.pageNumber
      const pdfHeight = page.pdfHeight
      const scaleX = page.renderedWidth > 0 ? page.pdfWidth / page.renderedWidth : 0.5
      const scaleY = page.renderedHeight > 0 ? page.pdfHeight / page.renderedHeight : 0.5

      // 1) 수식 → (PDF 포인트 bbox, latex) 정규화 + trivial 제외
      interface FormulaCandidate {
        block: IRBlock
        pdfBbox: { x1: number; x2: number; yTop: number; yBottom: number }
        centerY: number // PDF bottom-up
      }
      const candidates: FormulaCandidate[] = []
      for (const r of page.regions) {
        if (!r.latex || !r.latex.trim()) continue
        const wrapped = r.kind === "display" ? `$$${r.latex}$$` : `$${r.latex}$`

        const x1 = r.bbox.x1 * scaleX
        const x2 = r.bbox.x2 * scaleX
        // pdfium 픽셀 y → PDF bottom-up
        const yTop = pdfHeight - r.bbox.y1 * scaleY
        const yBottom = pdfHeight - r.bbox.y2 * scaleY
        const centerY = (yTop + yBottom) / 2
        const width = x2 - x1
        const height = yTop - yBottom

        candidates.push({
          block: {
            type: "paragraph",
            text: wrapped,
            pageNumber,
            bbox: { page: pageNumber, x: x1, y: yBottom, width, height },
          },
          pdfBbox: { x1, x2, yTop, yBottom },
          centerY,
        })
      }
      if (candidates.length === 0) continue

      // 2) 같은 페이지의 pdfjs block 중 수식 bbox 와 크게 겹치는 것 제거
      //    (pdfjs 가 수식을 텍스트로 파편 추출한 경우 — overlap ratio ≥ 0.6 이면 중복으로 간주)
      const OVERLAP_THRESHOLD = 0.6
      const indicesToRemove = new Set<number>()
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]
        if (b.pageNumber !== pageNumber) continue
        if (b.type === "table") continue // 표는 건드리지 않음
        if (!b.bbox || b.bbox.width <= 0 || b.bbox.height <= 0) continue
        const blockArea = b.bbox.width * b.bbox.height
        if (blockArea <= 0) continue

        for (const c of candidates) {
          const ox1 = Math.max(b.bbox.x, c.pdfBbox.x1)
          const ox2 = Math.min(b.bbox.x + b.bbox.width, c.pdfBbox.x2)
          const oy1 = Math.max(b.bbox.y, c.pdfBbox.yBottom)
          const oy2 = Math.min(b.bbox.y + b.bbox.height, c.pdfBbox.yTop)
          const interArea = Math.max(0, ox2 - ox1) * Math.max(0, oy2 - oy1)
          if (interArea / blockArea >= OVERLAP_THRESHOLD) {
            indicesToRemove.add(i)
            break
          }
        }
      }

      if (indicesToRemove.size > 0) {
        // 내림차순으로 제거해야 인덱스가 밀리지 않음
        const sorted = [...indicesToRemove].sort((a, b) => b - a)
        for (const idx of sorted) blocks.splice(idx, 1)
        removedDupCount += indicesToRemove.size
      }

      // 3) 각 수식을 y 좌표 기준 적절한 위치에 삽입
      //    수식들을 위→아래(centerY 큰 것부터) 정렬 후, 각 수식마다 현재 blocks 에서
      //    "center y < 수식 center y" 인 첫 블록(= 수식보다 아래) 앞에 삽입.
      candidates.sort((a, b) => b.centerY - a.centerY)

      for (const c of candidates) {
        let insertIdx = -1
        let pageFirstIdx = -1
        let pageLastIdx = -1
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i]
          if (b.pageNumber !== pageNumber) continue
          if (pageFirstIdx === -1) pageFirstIdx = i
          pageLastIdx = i
          if (!b.bbox) continue
          const blockCenter = b.bbox.y + b.bbox.height / 2
          if (blockCenter < c.centerY) {
            insertIdx = i
            break
          }
        }

        if (insertIdx !== -1) {
          blocks.splice(insertIdx, 0, c.block)
        } else if (pageLastIdx !== -1) {
          blocks.splice(pageLastIdx + 1, 0, c.block)
        } else {
          // 해당 페이지에 텍스트 블록 없음 — 맨 끝에 추가
          blocks.push(c.block)
        }
        insertedCount++
      }
    }

    if (insertedCount > 0 || removedDupCount > 0) {
      process.stderr.write(
        `[kordoc-formula] ${insertedCount}개 수식 삽입, ${removedDupCount}개 중복 block 제거 (${pagesResult.length}개 페이지)\n`,
      )
    }
  } finally {
    await pipeline.destroy().catch(() => {})
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
