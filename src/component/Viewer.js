import PDFJS, { PDFViewer as PDFViewerCore } from './pdf.js'
const { EventBus, PDFLinkService, PDFFindController, NullL10n, PDFViewer, PDFHistory } = PDFViewerCore
import i18n from './i18n'

export const SCROLL_MODE = {
  UNKNOWN: -1,
  VERTICAL: 0,
  HORIZONTAL: 1,
  WRAPPED: 2
}

export default class Viewer extends EventBus {
  constructor ({ container, onlyCssZoom, textLayer, scale }) {
    super()
    this.eventBus = new EventBus()

    this.linkService = new PDFLinkService({
      eventBus: this.eventBus
    })

    this.findController = new PDFFindController({
      eventBus: this.eventBus,
      linkService: this.linkService
    })

    this.l10n = NullL10n

    this.viewer = new PDFViewer({
      container,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      l10n: this.l10n,
      useOnlyCssZoom: onlyCssZoom,
      textLayerMode: textLayer
    })

    this.linkService.setViewer(this.viewer)

    this.history = new PDFHistory({
      eventBus: this.eventBus,
      linkService: this.linkService
    })

    this.linkService.setHistory(this.history)

    this.eventBus.on('pagesinit', () => {
      // We can use pdfViewer now, e.g. let's change default scale.
      this.setScale(scale)
      this.dispatch('pages:init')
    })

    this.eventBus.on(
      'pagechanging',
      (evt) => {
        this.dispatch('pages:changed', evt.pageNumber)
        /* const page = evt.pageNumber
        const numPages = this.pagesCount

        this.page = page
        this.previousDisabled = page <= 1
        this.nextDisabled = page >= numPages */
      },
      true
    )
  }

  setScale (value) {
    this.viewer.currentScaleValue = value
  }

  async open (params) {
    if (this.loadingTask) {
      // We need to destroy already opened document
      await this.close()
      // ... and repeat the open() call.
      return this.open(params)
    }

    const url = params.url
    this.setTitleUsingUrl(url)

    // Loading document.
    this.loadingTask = PDFJS.getDocument({
      url
      // maxImageSize: this.maxImageSize
      // cMapUrl: CMAP_URL,
      // cMapPacked: CMAP_PACKED,
    })

    this.loadingTask.onProgress = (progressData) => {
      this.dispatch('document:progress', progressData.loaded / progressData.total)
    }

    try {
      this.document = await this.loadingTask.promise
      // Document loaded, specifying document for the viewer.
      this.viewer.setDocument(this.document)
      this.linkService.setDocument(this.document)
      this.history.initialize({
        fingerprint: this.document.fingerprint
      })

      // dispatch page
      this.dispatch('document:init', {
        page: this.viewer.currentPageNumber,
        pagesCount: this.document.numPages || 0
      })
      this.setTitleUsingMetadata(this.document)
    } catch (exception) {
      const message = exception && exception.message

      let loadingErrorMessage

      if (exception instanceof PDFJS.InvalidPDFException) {
        // change error message also for other builds
        loadingErrorMessage = this.l10n.get(
          'invalid_file_error',
          null,
          'Invalid or corrupted PDF file.'
        )
      } else if (exception instanceof PDFJS.MissingPDFException) {
        // special message for missing PDFs
        loadingErrorMessage = this.l10n.get(
          'missing_file_error',
          null,
          'Missing PDF file.'
        )
      } else if (exception instanceof PDFJS.UnexpectedResponseException) {
        loadingErrorMessage = this.l10n.get(
          'unexpected_response_error',
          null,
          'Unexpected server response.'
        )
      } else {
        loadingErrorMessage = this.l10n.get(
          'loading_error',
          null,
          'An error occurred while loading the PDF.'
        )
      }

      const msg = await loadingErrorMessage
      this.error(msg, { message })
    }

    this.dispatch('document:loaded')
  }

  async close () {
    // hidden errorMessage

    if (!this.loadingTask) {
      return
    }

    const promise = this.loadingTask.destroy()
    this.loadingTask = null

    if (this.document) {
      this.document = null

      this.viewer.setDocument(null)
      this.linkService.setDocument(null, null)
      this.findController.setDocument(null)

      if (this.history) {
        this.history.reset()
      }
    }

    return promise
  }

  error (msg, config) {
    this.dispatch('error', config.message || msg)
  }

  setTitleUsingUrl (url) {
    let title = PDFJS.getFilenameFromUrl(url) || url
    try {
      title = decodeURIComponent(title)
    } catch (e) {
      // decodeURIComponent may throw URIError,
      // fall back to using the unprocessed url in that case
    }
    this.setTitle(title)
  }

  async setTitleUsingMetadata (document) {
    try {
      const { info, metadata } = await document.getMetadata()
      this.documentInfo = info
      this.metadata = metadata

      console.log(
        'PDF ' +
          document.fingerprint +
          ' [' +
          info.PDFFormatVersion +
          ' ' +
          (info.Producer || '-').trim() +
          ' / ' +
          (info.Creator || '-').trim() +
          ']' +
          ' (PDF.js: ' +
          (PDFJS.version || '-') +
          ')'
      )

      let pdfTitle
      if (metadata && metadata.has('dc:title')) {
        const title = metadata.get('dc:title')
        // Ghostscript sometimes returns 'Untitled', so prevent setting the
        // title to 'Untitled.
        if (title !== 'Untitled') {
          pdfTitle = title
        }
      }

      if (!pdfTitle && info && info.Title) {
        pdfTitle = info.Title
      }

      if (pdfTitle) {
        this.setTitle(pdfTitle)
      }
    } catch (exception) {
      // soon...
    }
  }

  setTitle (title) {
    // document.title = title
    this.dispatch('title', title)
  }

  get page () {
    return this.viewer.currentPageNumber
  }

  set page (value) {
    this.viewer.currentPageNumber = value
  }

  toggleScroll () {
    if (this.viewer.scrollMode !== SCROLL_MODE.HORIZONTAL) {
      this.viewer.scrollMode = SCROLL_MODE.HORIZONTAL
    } else {
      this.viewer.scrollMode = SCROLL_MODE.VERTICAL
    }
  }

  zoomIn (maxScale, scaleDelta, ticks) {
    let newScale = this.viewer.currentScale

    do {
      newScale = (newScale * scaleDelta).toFixed(2)
      newScale = Math.ceil(newScale * 10) / 10
      newScale = Math.min(maxScale, newScale)
    } while (--ticks && newScale < maxScale)

    this.setScale(newScale)
  }

  zoomOut (minScale, scaleDelta, ticks) {
    let newScale = this.viewer.currentScale

    do {
      newScale = (newScale / scaleDelta).toFixed(2)
      newScale = Math.floor(newScale * 10) / 10
      newScale = Math.max(minScale, newScale)
    } while (--ticks && newScale > minScale)

    this.setScale(newScale)
  }

  changePage (value) {
    this.page = value | 0

    // Ensure that the page number input displays the correct value,
    // even if the value entered by the user was invalid
    // (e.g. a floating point number).
    if (value !== this.page.toString()) {
      this.dispatch('page:changed', this.page)
    }
  }

  search (query) {
    this.findController.executeCommand('find', {
      caseSensitive: false,
      // findPrevious: undefined,
      highlightAll: true,
      phraseSearch: true,
      query
    })
  }

  async openDocument (src) {
    if (!src) {
      this.dispatch('error', i18n.messageBlank)
      return
    }
    // src: 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf'
    // show loading
    try {
      this.open({ url: src })
      // clean error
    } catch (exception) {
      this.dispatch('error', exception.message)
    }
  }
}
