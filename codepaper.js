/*
 * Copyright (c) 2014 Simon Robinson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* jshint globalstrict: true, browser:true */
'use strict';

var CodePaper = CodePaper || {};
var InitialUI = InitialUI || {};
var PDFConverter = PDFConverter || {};


// global configuration variables
CodePaper.config = {
	CONNECTION_TIMEOUT: 10000, // how long to wait before showing the connection error message (10 sec)

	MINIMUM_PAPER_SIZE: 63, // mm; square - 3 x minimum QR code size is ok (TODO: allow long thin documents etc)

	DEFAULT_DPI: 72, // for resizing images to their mm size (TODO: is there a better way?)

	QR_IDENTIFIER_NUM_BOXES: 7, // number of boxes in one of the three key identifiers (should never change)
	QR_MARGIN: 2, // mm - can be customised for easier scanning

	TICKBOX_SNAP_DISTANCE: 3, // mm - can be customised if required
	TICKBOX_STROKE_WIDTH: 0.5, // line size for tickboxes - default is 0.5 (0.25 either side of the box's line)

	EXPORT_FILENAME: 'enterise', // name for the exported document (without .pdf extension)

	// get the, e.g., 8x11 string for the upper right QR code
	getDimensionCodeString: function (numXCodes, numYCodes) {
		return numXCodes + 'x' + numYCodes;
	}
};


// attributes for each page
CodePaper.common = {
	r: null, // the Raphael object
	qr: null, // the QRCode object
	pdf: null, // the PDF exporter - don't actually initialise here, as there's no way to clear the document...

	pageKey: null, // the current page's hash value - must be <= 7 characters so that both qr codes are the same size
	pageType: 0, // 1 = TicQR; 2 = PaperChains (as in pages.php)

	paperSize: { // the paper (background) size in mm
		width: 0,
		height: 0
	},

	page: null, // a Raphael set to hold all page elements
	paper: null, // a Raphael rect used as the page background
	backgroundImage: null, // any background image that is being used

	svgPoint: null, // used for coordinate transformation

	qrCodeSize: 0, // mm size of the qr code as a whole, including its border; initialised below
	qrSquareSize: 0, // mm size of an individual QR block (we assume both codes are the same size - see pageKey)

	leftCodeContainer: null, // containers for the two QR codes
	rightCodeContainer: null,

	qrGuidanceGrid: null, // a grid to help show where QR codes can be placed
	qrSafeArea: null, // a highlight for the area that QR codes can be placed in
	contentIgnoredArea: null, // a highlight for the area that QR codes can *not* be placed in

	tickBoxes: null, // a Raphael set to hold all tickboxes
	audioAreas: null, // a Raphael set to hold all audio areas

	tickBoxSize: null, // equal to the size of a QR code block minus the stroke width of a tickbox

	setup: function () {
		/* global Raphael, QRCode */
		CodePaper.common.r = new Raphael('paper-holder', '100%', '100%');
		CodePaper.common.qr = new QRCode();

		CodePaper.common.page = CodePaper.common.r.set();
		CodePaper.common.svgPoint = CodePaper.common.r.canvas.createSVGPoint();

		CodePaper.common.tickBoxes = CodePaper.common.r.set();
		CodePaper.common.audioAreas = CodePaper.common.r.set();
	}
};


// setup functions for all the page elements
CodePaper.setup = {
	initialise: function (setupParameters) {
		CodePaper.common.setup();

		// setup page dimensions based on the setupParameters given
		var existingDocument = setupParameters.existingConfiguration;
		if (existingDocument) {
			// editing a page that already exists
			CodePaper.common.pageKey = existingDocument.pageKey;
			CodePaper.common.pageType = existingDocument.type;
			CodePaper.common.paperSize = {
				width: existingDocument.width,
				height: existingDocument.height
			};
			history.replaceState({}, '', '#' + CodePaper.common.pageKey); // TODO: is this ok?
			if (setupParameters.backgroundImage) {
				document.getElementById('includeimage').style.display = 'block'; // only applies to image documents
			}

		} else if (setupParameters.backgroundImage) {
			// new page from a local image
			CodePaper.common.backgroundImage = setupParameters.backgroundImage.src;
			CodePaper.common.paperSize = {
				width: setupParameters.backgroundImage.width,
				height: setupParameters.backgroundImage.height
			};
			document.getElementById('includeimage').style.display = 'block'; // only applies to image documents

		} else {
			// new blank page
			CodePaper.common.paperSize = {
				width: setupParameters.width,
				height: setupParameters.height
			};
		}

		// set up the page background - use the background image as the paper, if present
		var paper;
		if (CodePaper.common.backgroundImage !== null) {
			paper = CodePaper.common.r.image(setupParameters.backgroundImage.src, 0, 0,
				CodePaper.common.paperSize.width, CodePaper.common.paperSize.height);
		} else {
			paper = CodePaper.common.r.rect(0, 0, CodePaper.common.paperSize.width, CodePaper.common.paperSize.height);
		}
		paper.node.id = 'paper'; // for css styling
		paper.mousedown(CodePaper.event.handleMouseDown);
		paper.mousemove(CodePaper.event.handleMouseMove);
		paper.mouseup(CodePaper.event.handleMouseUp);
		CodePaper.common.paper = paper;

		// resize the canvas to the width of the paper
		CodePaper.event.resizePage();

		// set up QR codes and the guidance grids (loading existing positions if provides)
		if (existingDocument) {
			CodePaper.setup.addQRCodes(existingDocument.leftCodeX, existingDocument.leftCodeY,
				existingDocument.rightCodeX, existingDocument.rightCodeY);
		} else {
			CodePaper.setup.addQRCodes();
		}
		CodePaper.setup.createMovementGuide();

		// set up tickbox size (depends on QR size) - only subtract 1x width as it is half either side of the line
		CodePaper.common.tickBoxSize = (CodePaper.config.QR_IDENTIFIER_NUM_BOXES *
			CodePaper.common.qrSquareSize) - CodePaper.config.TICKBOX_STROKE_WIDTH;
		CodePaper.common.page.push(CodePaper.common.tickBoxes);

		// zoom to the page size so it shows fully in the SVG area
		// TODO: this handles large heights well, but widths badly (due to css)
		CodePaper.common.r.setViewBox(0, 0, CodePaper.common.paperSize.width, CodePaper.common.paperSize.height);

		// configure the UI
		document.getElementById('download').addEventListener('click', CodePaper.event.downloadPage);
		document.addEventListener('mousemove', CodePaper.event.handleMouseMove);
		document.addEventListener('mouseup', CodePaper.event.handleMouseUp);
		document.addEventListener('mouseout', CodePaper.event.handleMouseOut);
		document.addEventListener('keydown', CodePaper.event.handleKeyDown);

		// add existing content if present; otherwise prompt for type choice
		if (existingDocument) {
			// need parseInt because JSON values are string-wrapped... (TODO: fix)
			switch (parseInt(existingDocument.type, 10)) {
			case 1:
				// be aware that the tickbox dimensions are the *centre* of the box (they are size-independent);
				// audio areas are the positions of each (left, top, right, bottom) border of the area
				var numTickBoxes = existingDocument.tickBoxes.length;
				for (var boxIndex = 0; boxIndex < numTickBoxes; boxIndex += 1) {
					var box = existingDocument.tickBoxes[boxIndex];
					CodePaper.ticqr.addTickBox(box.x, box.y, box.id, box.description, box.quantity);
				}
				if (existingDocument.destination !== undefined) {
					document.getElementById('emailaddress').value = existingDocument.destination;
				}
				document.getElementById('configuration').style.display = 'block';

				if (existingDocument.locked === true) {
					CodePaper.dialog.show('Warning: this document has been scanned, and is now locked – ' +
						'changes you make will not be saved<br><br>To modify this document you will need to create ' +
						'a new page from these elements<br><span class="pure-button button-large" ' +
						'id="page-locked-ignore">Ignore</span><span class="pure-button button-large" ' +
						'id="page-locked-new-page">Create a new page</span>', 400, function (modal) {
							modal.modalElem().querySelector('#page-locked-ignore').onclick = function () {
								modal.close();
							};
							modal.modalElem().querySelector('#page-locked-new-page').onclick = function () {
								modal.close();
								CodePaper.remote.requestJsonP('duplicate=' + CodePaper.common.pageKey +
									'&callback=InitialUI.loadDuplicateDocument');
							};
						});
				}

				break;

			case 2:
				var numAudioAreas = existingDocument.audioAreas.length;
				for (var audioIndex = 0; audioIndex < numAudioAreas; audioIndex += 1) {
					var audio = existingDocument.audioAreas[audioIndex];
					CodePaper.paperchains.addAudioArea(audio.left, audio.top, audio.right, audio.bottom,
						audio.id, audio.soundCloudId);
				}
				document.getElementById('configuration').style.display = 'none';

				if (existingDocument.locked === true) {
					CodePaper.dialog.show('This document has been scanned, and is now locked – changes you make to ' +
						'its layout will not be saved<br><br>To add audio to this document, you should use the ' +
						'<a href="https://play.google.com/store/apps/details?id=ac.robinson.paperchains">PaperChains ' +
						'app</a><br><span class="pure-button button-large" id="page-locked-ignore">Continue</span>',
						400, function (modal) {
							modal.modalElem().querySelector('#page-locked-ignore').onclick = function () {
								modal.close();
							};
						});
				}
				break;

			default:
				// unknown/unset
				CodePaper.ui.showPageTypeChooser();
				break;
			}
		} else {
			CodePaper.ui.showPageTypeChooser();
		}
	},

	addImage: function (image) {
		// only allow images that are the same size ratio as the page
		// TODO: store pageKeys that have images in local storage so we can prompt to re-drag/drop?
		var imageRatio = image.width / image.height;
		var paperRatio = CodePaper.common.paperSize.width / CodePaper.common.paperSize.height;
		if (Math.abs(imageRatio - paperRatio) < 0.01) {
			CodePaper.common.backgroundImage = image.src;

			var newImage = CodePaper.common.r.image(image.src, 0, 0, image.width, image.height);
			newImage.node.id = 'paper';
			newImage.mousedown(CodePaper.event.handleMouseDown);
			newImage.mousemove(CodePaper.event.handleMouseMove);
			newImage.mouseup(CodePaper.event.handleMouseUp);

			newImage.insertAfter(CodePaper.common.paper);
			CodePaper.common.paper.remove();
			CodePaper.common.paper = newImage;

			document.getElementById('includeimage').style.display = 'block'; // only applies to image documents

		} else {
			CodePaper.dialog.show('Sorry, unable to include that image – its size does not match<br><br>Please ensure ' +
				'that the image you use has the same width/height ratio as the page (' + CodePaper.common.paperSize.width + 'mm × ' +
				CodePaper.common.paperSize.height + 'mm).<br><br>The dimensions of the image you chose are: ' +
				image.width + 'pixels × ' + image.height + 'pixels<br><span class="pure-button button-large" ' +
				'id="image-size-incorrect">Ignore</span>', 400, function (modal) {
					modal.modalElem().querySelector('#image-size-incorrect').onclick = function () {
						modal.close();
					};
				});
		}
	},

	addQRCodes: function (initialLeftCodeX, initialLeftCodeY, initialRightCodeX, initialRightCodeY) {
		// add the qr codes, creating the left code first as it is only dependent on the page key (not size/position)
		var paperSize = CodePaper.common.paperSize; // localise for convenience
		var leftCode = CodePaper.setup.makeQRCode(CodePaper.common.pageKey, CodePaper.config.QR_MARGIN);

		// we assume square code areas (always); and, that both codes are same size (see pageKey)
		var qrCodeSize = Math.round(leftCode.getBBox().width + (2 * CodePaper.config.QR_MARGIN));

		// if we were given existing code positions, use them
		var loadExistingCodes = initialLeftCodeX !== undefined && initialLeftCodeY !== undefined &&
			initialRightCodeX !== undefined && initialRightCodeY !== undefined;
		var numXCodes;
		var numYCodes;
		if (loadExistingCodes) {
			numXCodes = ((initialRightCodeX - initialLeftCodeX) / qrCodeSize) + 1;
			numYCodes = ((initialLeftCodeY - initialRightCodeY) / qrCodeSize) + 1;
		} else {
			numXCodes = Math.floor(paperSize.width / qrCodeSize);
			numYCodes = Math.floor(paperSize.height / qrCodeSize);
		}

		// create the right code, using the calculated position
		var rightCode = CodePaper.setup.makeQRCode(CodePaper.config.getDimensionCodeString(numXCodes, numYCodes),
			CodePaper.config.QR_MARGIN);

		// style qr codes, and keep them in sets so we can update later
		var leftContainer = CodePaper.common.r.set();
		var leftCodeBackground = CodePaper.common.r.rect(0, 0, qrCodeSize, qrCodeSize);
		leftCodeBackground.insertBefore(leftCode);
		leftContainer.push(leftCodeBackground);
		leftContainer.push(leftCode);
		leftContainer._ccBackground = leftCodeBackground;
		leftContainer._ccCode = leftCode;

		var rightContainer = CodePaper.common.r.set();
		var rightCodeBackground = CodePaper.common.r.rect(0, 0, qrCodeSize, qrCodeSize);
		rightCodeBackground.insertBefore(rightCode);
		rightContainer.push(rightCodeBackground);
		rightContainer.push(rightCode);
		rightContainer._ccBackground = rightCodeBackground;
		rightContainer._ccCode = rightCode;

		var codeStyle = {
			fill: '#fff'
		};
		leftCodeBackground.attr(codeStyle);
		rightCodeBackground.attr(codeStyle);

		// hide the blank left code initially
		codeStyle.fill = '#000';
		rightCode.attr(codeStyle);
		if (CodePaper.common.pageKey !== null) {
			leftCode.attr(codeStyle);
		} else {
			leftCode.attr({
				'fill': '#fff'
			});
		}

		// add event handlers so the codes can be dragged
		codeStyle = {
			'stroke-width': 0,
			cursor: 'move'
		};
		leftContainer.attr(codeStyle);
		leftContainer.mousedown(CodePaper.event.handleQRMouseDown);
		rightContainer.attr(codeStyle);
		rightContainer.mousedown(CodePaper.event.handleQRMouseDown);

		// calculate where codes should be positioned on the grid
		if (loadExistingCodes) {
			leftContainer.transform('t' + initialLeftCodeX + ',' + initialLeftCodeY);
			rightContainer.transform('t' + initialRightCodeX + ',' + initialRightCodeY);
		} else {
			var leftCodeY = qrCodeSize * (Math.floor(paperSize.height / qrCodeSize) - 1);
			var rightCodeX = qrCodeSize * (Math.floor(paperSize.width / qrCodeSize) - 1);
			leftContainer.transform('t0,' + leftCodeY);
			rightContainer.transform('t' + rightCodeX + ',0');

			// create a new document with these parameters
			CodePaper.remote.requestJsonP('new=true&width=' + paperSize.width + '&height=' + paperSize.height +
				'&leftCodeX=0&leftCodeY=' + leftCodeY + '&rightCodeX=' + rightCodeX +
				'&rightCodeY=0&callback=CodePaper.setup.updateDocumentWithPageKey');
		}

		// create the overlay highglighting where is safe to move codes
		var safeArea = CodePaper.common.r.rect(0, 0, paperSize.width, paperSize.height);
		safeArea.attr({
			'stroke-width': 0,
			fill: '#0f0',
			opacity: 0.15
		});
		safeArea.insertAfter(CodePaper.common.paper);
		safeArea.mousemove(CodePaper.event.handleMouseMove); // need mouse events as we cover the paper
		safeArea.mouseup(CodePaper.event.handleMouseUp);
		safeArea.hide();

		// create the guidance grid for help when moving the QR codes (shown/hidden when moving)
		var guidanceGrid = CodePaper.common.r.set();
		for (var i = 0; i <= Math.floor(paperSize.width / qrCodeSize); i += 1) {
			var xPos = i * qrCodeSize;
			guidanceGrid.push(CodePaper.common.r.path(['M', xPos, 0, 'L', xPos, paperSize.height]));
		}
		for (i = 0; i <= Math.floor(paperSize.height / qrCodeSize); i += 1) {
			var yPos = i * qrCodeSize;
			guidanceGrid.push(CodePaper.common.r.path(['M', 0, yPos, 'L', paperSize.width, yPos]));
		}
		guidanceGrid.attr({
			'stroke-width': 0.2,
			stroke: '#bbb'
		});
		guidanceGrid.insertAfter(CodePaper.common.paper);
		guidanceGrid.hide();

		// store our changes
		CodePaper.common.page.push(leftContainer);
		CodePaper.common.page.push(rightContainer);
		CodePaper.common.leftCodeContainer = leftContainer;
		CodePaper.common.rightCodeContainer = rightContainer;
		CodePaper.common.qrSafeArea = safeArea;
		CodePaper.common.qrCodeSize = qrCodeSize;
		CodePaper.common.qrGuidanceGrid = guidanceGrid;
	},

	makeQRCode: function (text, margin) {
		// create a qr code and return a Raphael set containing its rects (dark areas only - assume a white background)
		var qrSet = CodePaper.common.r.set();
		var qrCode = CodePaper.common.qr.makeCode(text === null ? '' : text);
		var numModules = qrCode.getModuleCount();
		var squareSize = (numModules - (2 * margin)) / numModules;
		for (var col = 0; col < numModules; col += 1) {
			for (var row = 0; row < numModules; row += 1) {
				if (qrCode.isDark(col, row)) {
					var rect = CodePaper.common.r.rect(margin + (squareSize * row), margin + (squareSize * col),
						squareSize, squareSize);
					qrSet.push(rect);
				}
			}
		}
		CodePaper.common.qrSquareSize = squareSize;
		return qrSet;
	},

	createMovementGuide: function () {
		// create the guidance for content that is inside/outside the safe areas
		if (CodePaper.common.contentIgnoredArea !== null) {
			CodePaper.common.contentIgnoredArea.remove(); // remove any previous element
		}

		// fit the area to the QR codes
		var leftBBox = CodePaper.common.leftCodeContainer.getBBox();
		var rightBBox = CodePaper.common.rightCodeContainer.getBBox();
		var paperSize = CodePaper.common.paperSize;
		var qrCodeSize = CodePaper.common.qrCodeSize;
		var pathString = 'M 0,0 ' +
			'l 0,' + paperSize.height + ' ' + paperSize.width + ',0 ' +
			'0,-' + paperSize.height + ' -' + paperSize.width + ',0 ' +
			'z ' +
			'm ' + leftBBox.x + ',' + rightBBox.y + ' ' +
			'l ' + (rightBBox.x - leftBBox.x + qrCodeSize) + ',0 0,' + (leftBBox.y - rightBBox.y + qrCodeSize) + ' ' +
			'-' + (rightBBox.x - leftBBox.x + qrCodeSize) + ',0 0,-' + (leftBBox.y - rightBBox.y + qrCodeSize) + ' ' +
			'z';
		var contentIgnoredArea = CodePaper.common.r.path(pathString);
		contentIgnoredArea.attr({
			fill: '#f00',
			'stroke-width': 0,
			opacity: 0.06
		});
		contentIgnoredArea.insertAfter(CodePaper.common.paper);
		// CodePaper.common.contentIgnoredArea.hide();
		CodePaper.common.contentIgnoredArea = contentIgnoredArea;
	},

	updateDocumentWithPageKey: function (result) {
		CodePaper.common.pageKey = result.pageKey;
		history.replaceState({}, '', '#' + result.pageKey); // TODO: is this ok?

		// we create a blank QR initially (to use in dimension calculations), then replace with the actual pageKey here
		setTimeout(function () {
			var leftCodeContainer = CodePaper.common.leftCodeContainer;
			var oldLeftCode = leftCodeContainer._ccCode;
			leftCodeContainer._ccCode = null;
			leftCodeContainer.exclude(oldLeftCode);
			oldLeftCode.remove();
			oldLeftCode = null;

			var newLeftCode = CodePaper.setup.makeQRCode(CodePaper.common.pageKey, CodePaper.config.QR_MARGIN);
			newLeftCode.insertAfter(leftCodeContainer._ccBackground);
			newLeftCode.transform('t0,' + leftCodeContainer.getBBox().y);
			newLeftCode.attr({
				'stroke-width': 0,
				fill: '#000',
				cursor: 'move'
			});
			newLeftCode.mousedown(CodePaper.event.handleQRMouseDown);

			leftCodeContainer.push(newLeftCode);
			leftCodeContainer._ccCode = newLeftCode;
		}, 0);
	},

	updatePageType: function (type, secondTry) {
		// TODO: if we allow switching types at any point, then this will need to reload page elements
		CodePaper.common.pageType = type;
		if (type == 1) {
			document.getElementById('configuration').style.display = 'block'; // TicQR
		} else {
			document.getElementById('configuration').style.display = 'none'; // PaperChains
		}
		
		if (CodePaper.common.pageKey !== null) {
			CodePaper.remote.requestJsonP('updatetype=' + CodePaper.common.pageKey + '&type=' + type +
				'&callback=CodePaper.remote.defaultCallback');
		} else if (secondTry !== true) {
			setTimeout(function () {
				CodePaper.setup.updatePageType(type, true);
			}, 2000); // if we haven't yet got a pageKey, try again shortly (but only once, to avoid never-ending loop)
		}
	},

	updateDestinationAddress: function (address) {
		CodePaper.remote.requestJsonP('updatedestination=' + CodePaper.common.pageKey +
			'&destination=' + encodeURIComponent(address) + '&callback=CodePaper.remote.defaultCallback');
	}
};


// helper functions for TicQR-related items
CodePaper.ticqr = {
	addTickBox: function (x, y, id, description, quantity) {
		// add a tickbox with its centre at the given x, y position, snapping to the page edges
		// there are 7 x <qrSquareSize>mm boxes in each QR code identifier; stroke is half either side of the line
		var tickBoxSize = CodePaper.common.tickBoxSize;
		var tickBoxStrokeWidth = CodePaper.config.TICKBOX_STROKE_WIDTH;
		x -= tickBoxSize / 2;
		y -= tickBoxSize / 2;

		// snap to canvas edges
		var strokeWidthCorrection = tickBoxStrokeWidth / 2;
		x = Math.max(x, strokeWidthCorrection);
		x = Math.min(x, CodePaper.common.paperSize.width - tickBoxSize - strokeWidthCorrection);
		y = Math.max(y, strokeWidthCorrection);
		y = Math.min(y, CodePaper.common.paperSize.height - tickBoxSize - strokeWidthCorrection);

		// add and style the box; add event handler
		var tickbox = CodePaper.common.r.rect(0, 0, tickBoxSize, tickBoxSize);
		tickbox.transform('t' + x + ',' + y);
		tickbox.attr({
			'stroke-width': tickBoxStrokeWidth,
			fill: '#fff',
			cursor: 'move'
		});

		tickbox.data('id', id !== undefined ? id : null); // no id until saved
		tickbox.data('description', description !== undefined ? description : '');
		tickbox.data('quantity', quantity !== undefined ? quantity : 1); // default to 1 for quantity
		tickbox.mousedown(CodePaper.event.handleMouseDown);
		tickbox.dblclick(CodePaper.ui.showTickBoxEditor.bind(tickbox)); // bind so events can modify tickbox data
		CodePaper.common.tickBoxes.push(tickbox);

		// add/edit guidance grid for snapping
		CodePaper.ticqr.updateTickBoxSnapGrid();

		return tickbox;
	},

	updateTickBoxSnapGrid: function () {
		var snapList = CodePaper.event.tickBoxSnapXs;
		while (snapList.length > 0) {
			snapList.pop();
		}
		snapList = CodePaper.event.tickBoxSnapYs;
		while (snapList.length > 0) {
			snapList.pop();
		}
		CodePaper.common.tickBoxes.forEach(function (element) {
			var bbox = element.getBBox();
			if (this.tickBoxSnapXs.indexOf(bbox.x) < 0) {
				this.tickBoxSnapXs.push(bbox.x);
			}
			if (this.tickBoxSnapYs.indexOf(bbox.y) < 0) {
				this.tickBoxSnapYs.push(bbox.y);
			}
		}.bind(CodePaper.event)); // bind for simpler code
	},

	updateTickBoxWithId: function (result) {
		CodePaper.common.tickBoxes.forEach(function (box) {
			// TODO: this loops over the whole list even when we've found the item
			if (box.data('tempId') == result.tempId) {
				box.data('id', result.id);
				box.removeData('tempId');

				// if they moved and mouseupped before the box ID was retrieved, we need to update to the new position
				var bbox = box.getBBox();
				if (bbox.cx !== result.x || bbox.cy !== result.y) {
					CodePaper.remote.requestJsonP('updatebox=' + result.id + '&x=' + Math.round(bbox.cx) +
						'&y=' + Math.round(bbox.cy) + '&page=' + CodePaper.common.pageKey +
						'&callback=CodePaper.remote.defaultCallback');
				}
			}
		});
	}
};


// helper functions for PaperChains-related items
CodePaper.paperchains = {
	addAudioArea: function (left, top, right, bottom, id, soundCloudId) {
		// add an audio area with the given x, y, width and height dimensions
		// TODO: add event handler to play the audio
		var audioarea = CodePaper.common.r.rect(left, top, right - left, bottom - top);
		audioarea.attr({
			'stroke-width': 0,
			fill: '#00f',
			opacity: 0.05
		});
		audioarea.data('id', id);
		audioarea.data('soundCloudId', soundCloudId);
		CodePaper.common.audioAreas.push(audioarea);
		return audioarea;
	}
};


// helper functions for JSONP requests
CodePaper.remote = {
	errorCounter: 0, // for tracking and handling connection timeouts/errors
	errorCalls: [],

	// TODO: error checking in requests (check result.status)
	requestJsonP: function (request) {
		var jsonp = document.createElement('script');
		jsonp.type = 'text/javascript';
		jsonp.src = 'http://enterise.info/codemaker/pages.php?' + request +
			'&success=CodePaper.remote.connectionSuccess&id=' + CodePaper.remote.errorCounter;
		document.head.appendChild(jsonp);

		// handle errors (fairly naively) by assigning each call an id and timeout, and tracking when they complete
		var currentError = CodePaper.remote.errorCounter;
		CodePaper.remote.errorCalls[currentError] = true;
		setTimeout(function () {
			CodePaper.remote.showConnectionError(currentError);
		}, CodePaper.config.CONNECTION_TIMEOUT);
		CodePaper.remote.errorCounter += 1;
	},

	defaultCallback: function (result) {
		/* jshint unused: false */
		// default callback where no action is needed
	},

	connectionSuccess: function (connectionId) {
		// cancel the error for this remote connection id
		CodePaper.remote.errorCalls[connectionId] = false;

		// avoid having an enormous array of completed calls - reset if all have succeeded (disabled due to issues)
		//	var resetArray = true;
		//	for (var i = 0; i < CodePaper.errorCalls.length; i += 1) {
		//		if (CodePaper.errorCalls[i] === true) {
		//			resetArray = false;
		//			break;
		//		}
		//	}
		//	if (resetArray === true) {
		//		CodePaper.errorCalls = new Array();
		//		CodePaper.errorCounter = 0;
		//	}
	},

	showConnectionError: function (errorId) {
		// show an error if we haven't received a response for a particular call id
		// TODO: on really slow connections we'll end up showing several of these in succession...
		if (CodePaper.remote.errorCalls[errorId] === true) {
			CodePaper.dialog.show('Is there an internet connection problem?<br><br>Unable to save your changes; ' +
				'any edits you make will be lost<br><span class="pure-button button-large" ' +
				'id="load-error-ignore">Ignore</span><span class="pure-button button-large" ' +
				'id="load-error-reload">Reload page</span>', 400, function (modal) {
					modal.modalElem().querySelector('#load-error-ignore').onclick = function () {
						modal.close();
					};
					modal.modalElem().querySelector('#load-error-reload').onclick = function () {
						modal.close();
						window.location.reload();
					};
				});
		}
	}
};


// event handlers
CodePaper.event = {
	selectedQRCode: null,
	selectedTickBox: null,
	previousSelectedTickBox: null, // so we can delete easily

	tickBoxSnapXs: [], // allow snapping to grid
	tickBoxSnapYs: [],
	tempId: 1, // used temporarily while we retrieve the real object id from the server; incremented every new object

	clickPointToCanvasPoint: function (x, y) {
		// because of our viewbox scaling, click positions are not correct - need to transform
		var screenMatrix = CodePaper.common.r.canvas.getScreenCTM();
		CodePaper.common.svgPoint.x = x;
		CodePaper.common.svgPoint.y = y;
		CodePaper.common.svgPoint = CodePaper.common.svgPoint.matrixTransform(screenMatrix.inverse());
		return {
			x: Math.round(CodePaper.common.svgPoint.x),
			y: Math.round(CodePaper.common.svgPoint.y)
		};
	},

	handleQRMouseDown: function (event) {
		// QR code moving is handled differently to other elements - we take account of the initial position, 
		// and show a grid/overlay for guidance
		var point = CodePaper.event.clickPointToCanvasPoint(event.pageX, event.pageY);

		var leftCodeContainer = CodePaper.common.leftCodeContainer;
		var rightCodeContainer = CodePaper.common.rightCodeContainer;
		var selectedQRCode = leftCodeContainer.isPointInside(point.x, point.y) ? leftCodeContainer : rightCodeContainer;
		var safeArea = CodePaper.common.qrSafeArea;

		selectedQRCode.mousemove(CodePaper.event.handleMouseMove);
		selectedQRCode.mouseup(CodePaper.event.handleMouseUp);

		var initialPosition = selectedQRCode._ccBackground.getBBox();
		selectedQRCode._ccBackground.data('startX', point.x - initialPosition.x);
		selectedQRCode._ccBackground.data('startY', point.y - initialPosition.y);

		// calculate safe area - need to do here (rather than once, like below) - don't know which one will be selected
		var otherCodeBBox;
		var qrCodeSize = CodePaper.common.qrCodeSize;
		var paperSize = CodePaper.common.paperSize;
		if (selectedQRCode === leftCodeContainer) {
			otherCodeBBox = rightCodeContainer.getBBox();
			safeArea.attr({
				width: otherCodeBBox.x - qrCodeSize,
				height: (Math.floor(paperSize.height / qrCodeSize) * qrCodeSize) - otherCodeBBox.y - (2 * qrCodeSize)
			});
			safeArea.transform('t0,' + (otherCodeBBox.y + (2 * qrCodeSize)));

		} else if (selectedQRCode === rightCodeContainer) {
			otherCodeBBox = leftCodeContainer.getBBox();
			safeArea.attr({
				width: (Math.floor(paperSize.width / qrCodeSize) * qrCodeSize) - otherCodeBBox.x - (2 * qrCodeSize),
				height: otherCodeBBox.y - qrCodeSize
			});
			safeArea.transform('t' + (otherCodeBBox.x + (2 * qrCodeSize)) + ',0');
		}

		// configure the movement hints
		selectedQRCode._ccBackground.data('safeArea', safeArea.getBBox());
		CodePaper.event.selectedQRCode = selectedQRCode;
		safeArea.show();
		CodePaper.common.qrGuidanceGrid.show();
	},

	handleMouseDown: function (event) {
		var clickedElement = CodePaper.common.r.getElementByPoint(event.pageX, event.pageY);

		// only page objects and the background have handlers, so a null check is an easy way to prevent adding boxes 
		// over QR codes (though it doesn't prevent dragging objects onto them...)
		if (clickedElement !== null) {
			if (CodePaper.common.pageType == 1) {
				// allow tickboxes to be dragged - store their origin point and transform when they are moved
				var point = CodePaper.event.clickPointToCanvasPoint(event.pageX, event.pageY);

				if (clickedElement.node.id === 'paper') {
					clickedElement = CodePaper.ticqr.addTickBox(point.x, point.y);
					clickedElement.data('tempId', CodePaper.event.tempId);

					// create a new tickbox with these parameters
					CodePaper.remote.requestJsonP('newbox=true&x=' + point.x + '&y=' + point.y +
						'&page=' + CodePaper.common.pageKey + '&tempId=' + CodePaper.event.tempId +
						'&callback=CodePaper.ticqr.updateTickBoxWithId');
					CodePaper.event.tempId += 1;
				}

				clickedElement.mousemove(CodePaper.event.handleMouseMove);
				clickedElement.mouseup(CodePaper.event.handleMouseUp);

				var initialPosition = clickedElement.getBBox();
				clickedElement.data('startX', point.x - initialPosition.x);
				clickedElement.data('startY', point.y - initialPosition.y);
				clickedElement.data('hasMoved', false);

				// highlight the current box; de-highlight the others
				CodePaper.common.tickBoxes.attr({
					stroke: '#000'
				});
				clickedElement.attr({
					stroke: '#0096ff'
				});

				CodePaper.event.selectedTickBox = clickedElement;
				// CodePaper.common.contentIgnoredArea.show();

			} else {
				// TODO: play PaperChains audio
			}
		}
	},

	handleMouseMove: function (event) {
		var point = CodePaper.event.clickPointToCanvasPoint(event.pageX, event.pageY);
		var selectedTickBox = CodePaper.event.selectedTickBox;
		var selectedQRCode = CodePaper.event.selectedQRCode;

		if (selectedTickBox !== null) {
			var newTickBoxX = point.x - selectedTickBox.data('startX');
			var newTickBoxY = point.y - selectedTickBox.data('startY');
			selectedTickBox.data('hasMoved', true);

			// snap to nearby/similar boxes within TICKBOX_SNAP_DISTANCE mm
			var snapXs = CodePaper.event.tickBoxSnapXs;
			var snapYs = CodePaper.event.tickBoxSnapYs;
			for (var xi = 0; xi < snapXs.length; xi += 1) {
				var nearX = snapXs[xi];
				if (Math.abs(newTickBoxX - nearX) < CodePaper.config.TICKBOX_SNAP_DISTANCE) {
					newTickBoxX = nearX;
					break;
				}
			}
			for (var yi = 0; yi < snapYs.length; yi += 1) {
				var nearY = snapYs[yi];
				if (Math.abs(newTickBoxY - nearY) < CodePaper.config.TICKBOX_SNAP_DISTANCE) {
					newTickBoxY = nearY;
					break;
				}
			}

			// snap to canvas edges
			var strokeWidthCorrection = CodePaper.config.TICKBOX_STROKE_WIDTH / 2;
			newTickBoxX = Math.max(newTickBoxX, strokeWidthCorrection);
			newTickBoxX = Math.min(newTickBoxX,
				CodePaper.common.paperSize.width - CodePaper.common.tickBoxSize - strokeWidthCorrection);
			newTickBoxY = Math.max(newTickBoxY, strokeWidthCorrection);
			newTickBoxY = Math.min(newTickBoxY,
				CodePaper.common.paperSize.height - CodePaper.common.tickBoxSize - strokeWidthCorrection);

			selectedTickBox.transform('t' + newTickBoxX + ',' + newTickBoxY);
		}

		if (selectedQRCode !== null) {
			var newQRCodeX = point.x - selectedQRCode._ccBackground.data('startX');
			var newQRCodeY = point.y - selectedQRCode._ccBackground.data('startY');

			// snap to grid squares
			var qrCodeSize = CodePaper.common.qrCodeSize;
			newQRCodeX = Math.round(newQRCodeX / qrCodeSize) * qrCodeSize;
			newQRCodeY = Math.round(newQRCodeY / qrCodeSize) * qrCodeSize;

			// snap to safe area - was: qrSafeArea.getBBox(); (changed for speed)
			var safeAreaBBox = selectedQRCode._ccBackground.data('safeArea');
			newQRCodeX = Math.max(newQRCodeX, safeAreaBBox.x);
			newQRCodeX = Math.min(newQRCodeX, safeAreaBBox.x2 - qrCodeSize);
			newQRCodeY = Math.max(newQRCodeY, safeAreaBBox.y);
			newQRCodeY = Math.min(newQRCodeY, safeAreaBBox.y2 - qrCodeSize);

			selectedQRCode.transform('t' + newQRCodeX + ',' + newQRCodeY);
		}
	},

	handleMouseUp: function (event) {
		/* jshint unused: false */

		var selectedTickBox = CodePaper.event.selectedTickBox;
		if (selectedTickBox !== null) {
			CodePaper.event.previousSelectedTickBox = selectedTickBox; // so we can delete easily
			selectedTickBox.mousemove(null);
			selectedTickBox.mouseup(null);
			CodePaper.ticqr.updateTickBoxSnapGrid();
			// CodePaper.common.contentIgnoredArea.hide();

			// update tickbox with its new parameters (only if already saved and re-IDd, and has actually moved)
			var newPosition = selectedTickBox.getBBox();
			if (selectedTickBox.data('tempId') === undefined && selectedTickBox.data('hasMoved') === true) {
				CodePaper.remote.requestJsonP('updatebox=' + selectedTickBox.data('id') +
					'&x=' + Math.round(newPosition.cx) + '&y=' + Math.round(newPosition.cy) +
					'&page=' + CodePaper.common.pageKey + '&callback=CodePaper.remote.defaultCallback');
			}

			selectedTickBox.data('hasMoved', false);
		}
		CodePaper.event.selectedTickBox = null;

		var selectedQRCode = CodePaper.event.selectedQRCode;
		if (selectedQRCode !== null) {
			selectedQRCode.mousemove(null);
			selectedQRCode.mouseup(null);
			CodePaper.common.qrSafeArea.hide();
			CodePaper.common.qrGuidanceGrid.hide();

			CodePaper.setup.createMovementGuide(); // need to reset the guide every time we move the QR codes

			// need to create the new right-hand code; use a separate timed function so we can return fast
			// TODO: check if the codes have actually moved?
			setTimeout(function () {
				var rightBBox = CodePaper.common.rightCodeContainer.getBBox();
				var leftBBox = CodePaper.common.leftCodeContainer.getBBox();

				// update on the server
				CodePaper.remote.requestJsonP('update=' + CodePaper.common.pageKey +
					'&width=' + CodePaper.common.paperSize.width + '&height=' + CodePaper.common.paperSize.height +
					'&leftCodeX=' + leftBBox.x + '&leftCodeY=' + leftBBox.y + '&rightCodeX=' + rightBBox.x +
					'&rightCodeY=' + rightBBox.y + '&callback=CodePaper.remote.defaultCallback');

				// create the new code
				var numXCodes = ((rightBBox.x - leftBBox.x) / CodePaper.common.qrCodeSize) + 1;
				var numYCodes = ((leftBBox.y - rightBBox.y) / CodePaper.common.qrCodeSize) + 1;

				var rightCodeContainer = CodePaper.common.rightCodeContainer;
				var oldRightCode = rightCodeContainer._ccCode;
				rightCodeContainer._ccCode = null;
				rightCodeContainer.exclude(oldRightCode);
				oldRightCode.remove();
				oldRightCode = null;

				var newRightCode = CodePaper.setup.makeQRCode(CodePaper.config.getDimensionCodeString(numXCodes,
					numYCodes), CodePaper.config.QR_MARGIN);
				newRightCode.insertAfter(rightCodeContainer._ccBackground);
				newRightCode.transform('t' + rightBBox.x + ',' + rightBBox.y);
				newRightCode.attr({
					'stroke-width': 0,
					fill: '#000',
					cursor: 'move'
				});
				newRightCode.mousedown(CodePaper.event.handleQRMouseDown);

				rightCodeContainer.push(newRightCode);
				rightCodeContainer._ccCode = newRightCode;

			}, 0);
		}
		CodePaper.event.selectedQRCode = null;
	},

	handleMouseOut: function (event) {
		// send mouseup when window mouseout occurs
		event = event ? event : window.event;
		var from = event.relatedTarget || event.toElement;
		if (!from || from.nodeName == 'HTML') {
			CodePaper.event.handleMouseUp(event);
		}
	},

	handleKeyDown: function (event) {
		var key = event.keyCode || event.charCode;
		var previousSelectedTickBox = CodePaper.event.previousSelectedTickBox;
		var previousBoxIsValid = previousSelectedTickBox !== null && !CodePaper.dialog.isShowing() &&
			previousSelectedTickBox.data('tempId') === undefined &&
			document.activeElement !== document.getElementById('emailaddress');

		if (key === 8 || key === 46) { // delete/backspace
			// delete the current box (but not if it hasn't yet been saved to the server)
			if (previousBoxIsValid) {
				// delete on the server
				CodePaper.remote.requestJsonP('deletebox=' + previousSelectedTickBox.data('id') +
					'&page=' + CodePaper.common.pageKey + '&callback=CodePaper.remote.defaultCallback');

				// remove from the UI
				CodePaper.common.tickBoxes.exclude(previousSelectedTickBox);
				previousSelectedTickBox.remove();
				CodePaper.common.previousSelectedTickBox = null;
				event.preventDefault();
				return false;
			}

		} else if (key === 37 || key === 38 || key === 39 || key === 40) { // left/up/right/down arrow keys
			// move the current box (but not if it hasn't yet been saved to the server)
			if (previousBoxIsValid) {
				var initialPosition = previousSelectedTickBox.getBBox();
				var newX = initialPosition.x + (key === 37 ? -1 : (key === 39 ? 1 : 0));
				var newY = initialPosition.y + (key === 38 ? -1 : (key === 40 ? 1 : 0));

				// snap to canvas edges
				var strokeWidthCorrection = CodePaper.config.TICKBOX_STROKE_WIDTH / 2;
				var paperSize = CodePaper.common.paperSize;
				var tickBoxSize = CodePaper.common.tickBoxSize;
				newX = Math.max(newX, strokeWidthCorrection);
				newX = Math.min(newX, paperSize.width - tickBoxSize - strokeWidthCorrection);
				newY = Math.max(newY, strokeWidthCorrection);
				newY = Math.min(newY, paperSize.height - tickBoxSize - strokeWidthCorrection);

				previousSelectedTickBox.transform('t' + newX + ',' + newY);
				var newPosition = previousSelectedTickBox.getBBox(); // to avoid manually calculating the centre

				if (newPosition.cx != initialPosition.cx || newPosition.cy != initialPosition.cy) {
					CodePaper.remote.requestJsonP('updatebox=' + previousSelectedTickBox.data('id') +
						'&x=' + Math.round(newPosition.cx) + '&y=' + Math.round(newPosition.cy) +
						'&page=' + CodePaper.common.pageKey + '&callback=CodePaper.remote.defaultCallback');
				}
			}

		} else if (key === 27) { // escape
			if (CodePaper.dialog.close()) { // TODO: closes some dialogs that shouldn't be skippable (e.g., type choice)
				event.preventDefault(); // don't propagate the event if a dialog was cancelled
			} else {
				CodePaper.event.selectedTickBox = null;
				CodePaper.common.tickBoxes.attr({ // reset tickbox styles
					stroke: '#000'
				});
				event.preventDefault();
			}

		} else if (key == 13) { // enter
			if (CodePaper.dialog.close()) {
				event.preventDefault(); // don't propagate the event if a dialog was cancelled
			}
		}
	},

	resizePage: function (event) {
		/* jshint unused: false */

		// update the SVG element's size whenever the window changes
		var newHeight = document.body.clientHeight - 10; // TODO: 10 is a bit of a hack to account for CSS padding - fix
		var newWidth = newHeight * (CodePaper.common.paperSize.width / CodePaper.common.paperSize.height);
		CodePaper.common.r.canvas.style.width = newWidth;
		CodePaper.common.r.canvas.style.height = newHeight;

		// using this "proper" method means that tickbox stroke widths are wrong (they appear far too small)
		// CodePaper.r.setSize(newWidth, newHeight);
	},

	downloadPage: function (event, includeImage) {
		// if a tickbox is selected it will show in blue in the exported PDF - fix
		CodePaper.common.selectedTickBox = null;
		CodePaper.common.tickBoxes.attr({
			stroke: '#000' // TODO: do this in a way that is reversible
		});

		var backgroundImage = null;
		if (includeImage || document.getElementById('includeimage').querySelector('input').checked) {
			backgroundImage = CodePaper.common.backgroundImage;
		}
		PDFConverter.download(CodePaper.common.paperSize, CodePaper.common.page, backgroundImage, CodePaper.config.EXPORT_FILENAME + '.pdf');
	}
};


// helper functions for showing interface messages
CodePaper.ui = {
	showTickBoxEditor: function (event) {
		// bind to 'this' -> bound to the tickbox object from earlier
		CodePaper.dialog.show('<input type="text" placeholder="Item description" autofocus><br><label>Quantity: ' +
			'<input type="number" min="1" max="999" step="1" value="1"></label><span ' +
			'class="pure-button button-small" id="edit-tickbox-details">Done</span>', 300, function (modal) {
				modal.modalElem().querySelector('#edit-tickbox-details').onclick = function () {
					modal.close();
				};
				var inputs = modal.modalElem().getElementsByTagName('input');
				inputs[0].value = this.data('description');
				inputs[0].focus(); // because autofocus in the element html only works once
				inputs[1].value = this.data('quantity');
			}.bind(this), function (modal) {
				var inputs = modal.modalElem().getElementsByTagName('input');
				var newDescription = inputs[0].value;
				var newQuantity = inputs[1].value;

				// update the tickbox object and the server with the changes
				if (this.data('description') != newDescription || this.data('quantity') != newQuantity) {
					this.data('description', newDescription);
					this.data('quantity', newQuantity);

					var bbox = this.getBBox();
					CodePaper.remote.requestJsonP('updatebox=' + this.data('id') + '&x=' + Math.round(bbox.cx) +
						'&y=' + Math.round(bbox.cy) + '&description=' + encodeURIComponent(newDescription) +
						'&quantity=' + encodeURIComponent(newQuantity) + '&page=' + CodePaper.common.pageKey +
						'&callback=CodePaper.remote.defaultCallback');
				}
			}.bind(this), event);
	},

	showPageTypeChooser: function () {
		CodePaper.dialog.show('Which system would you like to create a page for?<br><span ' +
			'class="pure-button button-large" id="choose-paperchains">PaperChains</span><span ' +
			'class="pure-button button-large" id="choose-ticqr">TicQR</span>', 400, function (modal) {
				modal.modalElem().querySelector('#choose-paperchains').onclick = function () {
					modal.close();
					CodePaper.ui.choosePaperChains();
				};
				modal.modalElem().querySelector('#choose-ticqr').onclick = function () {
					modal.close();
					CodePaper.ui.chooseTicQR();
				};
			});
	},

	choosePaperChains: function () {
		CodePaper.setup.updatePageType(2); // update on the server
		CodePaper.dialog.show('Great! Here\'s your document:<br><span class="pure-button button-large" ' +
			'id="download-paperchains-pdf">Download PDF</span><br><br><br>There\'s nothing else you need to do — ' +
			'you can start adding audio straight away using the PaperChains app<br><br>If you\'d like, however, ' +
			'you can tweak the code positions and the paper size you chose:<br><span ' +
			'class="pure-button button-large" id="edit-paperchains-page">Edit page</span>', 400, function (modal) {
				modal.modalElem().querySelector('#download-paperchains-pdf').onclick = function () {
					// include image by default - if they uploaded one for PaperChains then they probably want it
					modal.close();
					CodePaper.downloadPage(null, true);
				};
				modal.modalElem().querySelector('#edit-paperchains-page').onclick = function () {
					modal.close();
					CodePaper.dialog.show('A word of caution:<br><br>Initially, anyone can edit any PaperChains ' +
						'page to update its dimensions or code positions.<br><br>However, for peace of mind, once ' +
						'you (or anyone else) scan the page for the first time, its properties are locked, and no ' +
						'more changes are allowed.<br><span class="pure-button button-large" ' +
						'id="edit-paperchains-page">I understand — let me edit the page</span>', 400, function (modal) {
							modal.modalElem().querySelector('#edit-paperchains-page').onclick = function () {
								modal.close();
							};
						});
				};
			});
	},

	chooseTicQR: function () {
		CodePaper.setup.updatePageType(1); // update on the server
		CodePaper.dialog.show('Great! The next step is to add tickboxes to your document — click anywhere on the ' +
			'page to add a box<br><br>Double-click on any box to add item details, or press the delete key to ' +
			'remove a box<br><span class="pure-button button-large" id="edit-ticqr-page">Edit page</span>', 400, function (modal) {
				modal.modalElem().querySelector('#edit-ticqr-page').onclick = function () {
					modal.close();
					CodePaper.dialog.show('A word of caution:<br><br>Initially, anyone can edit any TicQR ' +
						'page to add tickboxes, change the destination email address, or update its dimensions or ' +
						'code positions.<br><br>However, for peace of mind, once you (or anyone else) scan the page ' +
						'for the first time, its properties are locked, and no more changes are allowed. If you need ' +
						'to edit the page after scanning, you will need to create a copy instead.<br><span ' +
						'class="pure-button button-large" id="edit-paperchains-page">I understand — let me ' +
						'edit the page</span>', 400, function (modal) {
							modal.modalElem().querySelector('#edit-paperchains-page').onclick = function () {
								modal.close();
							};
						});
				};
			});
	}
};


// helper functions for showing modal dialogs
CodePaper.dialog = {
	currentDialog: null,

	show: function (message, width, beforeShow, afterClose, positionEvent) {
		CodePaper.dialog.close(); // remove any existing dialogs

		/* global picoModal */
		picoModal({
			content: message,
			closeButton: false,
			overlayClose: false,
			overlayStyles: function (styles) {
				styles.opacity = '0.2';
			},
			modalStyles: function (styles) {
				if (positionEvent !== undefined && positionEvent !== null) {
					// show at a specific position if a click event is passed
					styles.left = Math.min(Math.max(width / 2, positionEvent.pageX), window.innerWidth - (width / 2)) + 'px';
					styles.top = Math.max(120, positionEvent.pageY) + 'px';
				} else {
					styles.top = '50%';
				}
				styles.width = width + 'px';
				styles.marginLeft = (-width / 2) + 'px';
				styles.marginTop = '-120px';
				styles.textAlign = 'center';
			}
		}).beforeShow(function (modal) {
			CodePaper.dialog.currentDialog = modal;
			if (beforeShow !== undefined && beforeShow !== null) {
				beforeShow(modal);
			}
		}).afterClose(function (modal) {
			if (afterClose !== undefined && afterClose !== null) {
				afterClose(modal);
			}
			modal.destroy();
			CodePaper.dialog.currentDialog = null;
		}).show();
	},

	isShowing: function () {
		return CodePaper.dialog.currentDialog !== null;
	},

	close: function () {
		if (CodePaper.dialog.currentDialog !== null) {
			CodePaper.dialog.currentDialog.close();
			CodePaper.dialog.currentDialog = null;
			return true;
		}
		return false;
	}
};


// handle export to PDF
PDFConverter = {
	pdf: null,

	// creates a new PDF document with all the items in the 'page' set
	download: function (paperSize, pageElements, backgroundImage, fileName) {
		var orientationString = 'portrait';
		var orientationArray = [paperSize.height, paperSize.width];
		if (paperSize.width > paperSize.height) {
			orientationString = 'landscape';
			orientationArray = [paperSize.width, paperSize.height];
		}
		/* global jsPDF */
		PDFConverter.pdf = new jsPDF(orientationString, 'mm', orientationArray);
		if (backgroundImage !== null) {
			var supportedImageTypes = ['jpeg', 'jpg', 'png']; // TODO: can we get from jsPDF directly?
			var imageType = backgroundImage.split(';')[0].split('/')[1]; // TODO: is there a better way?
			if (supportedImageTypes.indexOf(imageType) >= 0) {
				PDFConverter.pdf.addImage(backgroundImage, imageType, 0, 0, paperSize.width, paperSize.height);
			} else {
				console.log('Unsupported background image type - ignoring');
			}
		}
		pageElements.forEach(PDFConverter.addPDFItem);
		PDFConverter.pdf.save(fileName);
	},

	// add an individual page item to the pdf - for element detection see: http://stackoverflow.com/a/13915849
	addPDFItem: function (element, index) {
		if (element.constructor.prototype == Raphael.st) {
			element.forEach(PDFConverter.addPDFItem);
		} else {
			if (element.constructor.prototype == Raphael.el) {
				if (element.type == 'rect') {
					var bbox = element.getBBox();
					var styleString = PDFConverter.setPDFFill(element) + PDFConverter.setPDFStroke(element);
					PDFConverter.pdf.rect(bbox.x, bbox.y, bbox.width, bbox.height, styleString);
				} else {
					console.log('Unparsed Raphael element - ignoring item' + index);
				}
			} else {
				console.log('Unknown PDF element - ignoring item' + index);
			}
		}
	},

	// set the pdf fill colour if the given element has a fill colour set
	setPDFFill: function (element) {
		var fill = element.attr('fill');
		if (fill !== null) {
			var fillColour = PDFConverter.hexToRgb(fill);
			if (fillColour !== null) {
				PDFConverter.pdf.setFillColor(fillColour.r, fillColour.g, fillColour.b);
				return 'F';
			}
		}
		PDFConverter.pdf.setFillColor(0);
		return '';
	},

	// set the pdf stroke colour and width if the given element has a fill stroke and/or width set
	setPDFStroke: function (element) {
		var stroke = element.attr('stroke');
		if (stroke !== null) {
			var strokeWidth = element.attr('stroke-width');
			if (strokeWidth === null) {
				strokeWidth = 1; // svg stroke defaults to 1px?
			}
			if (strokeWidth > 0) {
				var strokeColour = PDFConverter.hexToRgb(stroke);
				if (strokeColour === null) { // svg colour defaults to black?
					strokeColour = {
						'r': 0,
						'g': 0,
						'b': 0
					};
				}
				PDFConverter.pdf.setDrawColor(strokeColour.r, strokeColour.g, strokeColour.b);
				PDFConverter.pdf.setLineWidth(strokeWidth);
				return 'D';
			}
		}
		PDFConverter.pdf.setDrawColor(0);
		PDFConverter.pdf.setLineWidth(0);
		return '';
	},

	hexToRgb: function (hex) {
		// convert a hex colour to RGB values (see: http://stackoverflow.com/a/5624139)
		var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i; // expand shorthand (e.g., '333' to full form
		hex = hex.replace(shorthandRegex, function (m, r, g, b) {
			return r + r + g + g + b + b;
		});

		var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
		return result ? {
			r: parseInt(result[1], 16),
			g: parseInt(result[2], 16),
			b: parseInt(result[3], 16)
		} : null;
	}
};


// handle setting up the initial page interface - allow file upload where possible, and set up the display
InitialUI = {
	tests: {
		filereader: typeof FileReader !== 'undefined',
		formdata: !!window.FormData,
		dnd: 'draggable' in document.createElement('span')
	},
	acceptedTypes: {
		'image/png': true,
		'image/jpeg': true,
		'image/gif': true
	},
	imageLoader: null,
	fileUpload: null,

	setup: function (pageKey) {
		if (pageKey !== undefined && pageKey.length > 0) {
			// load an initial document if requested
			CodePaper.remote.requestJsonP('edit=' + pageKey + '&callback=InitialUI.loadExistingDocument');
		}

		// initialise variables and tests for file upload features - based on http://html5demos.com/dnd-upload
		InitialUI.imageLoader = document.getElementById('image-loader');
		InitialUI.fileupload = document.getElementById('upload');
		if (InitialUI.tests.filereader === false || InitialUI.tests.formdata === false) {
			// hide image loader if unsupported
			document.getElementById('no-image-ui').style.display = 'block';
			InitialUI.imageLoader.hidden = true;
		}

		// allow drag&drop/file upload if supported
		if (InitialUI.tests.dnd === true) {
			InitialUI.fileupload.hidden = true;
			document.body.ondragover = function () {
				InitialUI.imageLoader.className = 'hover';
				return false;
			};
			document.body.ondragend = function () {
				InitialUI.imageLoader.className = '';
				return false;
			};
			document.body.ondrop = function (event) {
				event.preventDefault();
				InitialUI.imageLoader.className = '';
				InitialUI.readfiles(event.dataTransfer.files);
			};

		} else {
			document.getElementById('draganddrop').hidden = true;
			InitialUI.imageLoader.style.border = 'none';
			InitialUI.fileupload.querySelector('input').onchange = function () {
				InitialUI.readfiles(this.files);
			};
		}
	},

	readfiles: function (files) {
		var formData = InitialUI.tests.formdata ? new FormData() : null;
		for (var i = 0; i < files.length; i += 1) {
			if (InitialUI.tests.formdata) {
				formData.append('file', files[i]);
			}
			InitialUI.loadfile(files[i]);
			break; // we only want the first file
		}
	},

	loadfile: function (file) {
		if (InitialUI.tests.filereader === true && InitialUI.acceptedTypes[file.type] === true) {
			var reader = new FileReader();
			reader.onload = function (event) {
				var image = new Image();
				image.src = event.target.result;

				// resize pixels to millimetres
				var pxPerMM = CodePaper.config.DEFAULT_DPI / 25.4;
				image.width = Math.round(image.width / pxPerMM);
				image.height = Math.round(image.height / pxPerMM);

				if (image.width >= CodePaper.config.MINIMUM_PAPER_SIZE &&
					image.height >= CodePaper.config.MINIMUM_PAPER_SIZE) {
					InitialUI.createImageDocument(image);
				} else {
					InitialUI.showInvalidFileMessage('Sorry, "' + file.name + '" is too small. ' +
						'The width and height of the image must both be at least ' +
						CodePaper.config.MINIMUM_PAPER_SIZE + 'mm (current dimensions: ' +
						image.width + 'mm × ' + image.height + 'mm)');
				}
			};
			reader.readAsDataURL(file);

		} else {
			InitialUI.showInvalidFileMessage('Sorry, the file type of "' + file.name + '" is unsupported');
		}
	},

	showInvalidFileMessage: function (errorMessage) {
		// replace the existing error message
		var currentFileError = InitialUI.imageLoader.querySelector('#upload-error');
		if (currentFileError !== null) {
			currentFileError.parentNode.removeChild(currentFileError);
		}
		var text = document.createTextNode(errorMessage);
		var newParagraph = document.createElement('p');
		newParagraph.id = 'upload-error';
		newParagraph.appendChild(text);
		InitialUI.imageLoader.appendChild(newParagraph);

		// need to replace the input element - we don't get events more than once...
		var currentFileUpload = InitialUI.fileupload.querySelector('input');
		var newFileUpload = document.createElement('input');
		newFileUpload.type = 'file';
		newFileUpload.onchange = function () {
			InitialUI.readfiles(this.files);
		};
		currentFileUpload.parentNode.replaceChild(newFileUpload, currentFileUpload);
	},

	hideInitialUI: function () {
		document.getElementById('get-started').style.visibility = 'hidden';
		document.getElementById('code-ui').style.visibility = 'visible';

		// replace the paper element so we have a fresh page
		var paperHolder = document.getElementById('paper-holder');
		var newPaperHolder = document.createElement('div');
		newPaperHolder.id = 'paper-holder';
		paperHolder.parentNode.replaceChild(newPaperHolder, paperHolder);
	},

	createBlankDocument: function (x, y) {
		InitialUI.hideInitialUI();
		CodePaper.setup.initialise({
			width: x,
			height: y
		});
	},

	createImageDocument: function (image) {
		if (CodePaper.common.pageKey === null) {
			InitialUI.hideInitialUI();
			CodePaper.setup.initialise({
				backgroundImage: image
			});
		} else {
			CodePaper.setup.addImage(image);
		}
	},

	setDestinationAddress: function (address) {
		if (CodePaper.common.pageKey !== null) {
			CodePaper.setup.updateDestinationAddress(address);
		}
	},

	loadExistingDocument: function (configuration) {
		if (configuration.status == 'ok') {
			InitialUI.hideInitialUI();
			CodePaper.setup.initialise({
				existingConfiguration: configuration,
			});
		} else {
			CodePaper.dialog.show('Unable to find that page<br><br>You can create your own document from the ' +
				'CodeMaker homepage<br><span class="pure-button button-large" ' +
				'id="load-error-invalid">Home</span>', 400, function (modal) {
					modal.modalElem().querySelector('#load-error-invalid').onclick = function () {
						modal.close();
						window.location.assign(window.location.href.split('#')[0]);
					};
				});
		}
	},

	loadDuplicateDocument: function (configuration) {
		CodePaper.dialog.show('Copy created successfully – this new document may now be modified as usual<br><span ' +
			'class="pure-button button-large" id="duplicate-document-success">Continue</span>', 400, function (modal) {
				modal.modalElem().querySelector('#duplicate-document-success').onclick = function () {
					modal.close();
				};
			});
		InitialUI.loadExistingDocument(configuration);
	},

	showCustomPaperChooser: function (element) {
		element.style.display = 'none';
		document.getElementById('custom-paper-chooser').style.display = 'block';
	},

	chooseCustomPaperSize: function () {
		var xVal = parseInt(document.getElementById('custom-x-size').value);
		var yVal = parseInt(document.getElementById('custom-y-size').value);
		if (xVal >= CodePaper.config.MINIMUM_PAPER_SIZE && yVal >= CodePaper.config.MINIMUM_PAPER_SIZE) {
			InitialUI.createBlankDocument(xVal, yVal);
		} else {
			CodePaper.dialog.show('Currently, documents must be larger than ' + CodePaper.config.MINIMUM_PAPER_SIZE +
				'mm in both dimensions<br><span class="pure-button button-large" ' +
				'id="load-paper-size-invalid">Retry</span>', 400, function (modal) {
					modal.modalElem().querySelector('#load-paper-size-invalid').onclick = function () {
						modal.close();
					};
				});
		}
	},

	handleKeyDown: function () {
		var key = event.keyCode || event.charCode;
		if (key == 13) { // enter
			InitialUI.chooseCustomPaperSize();
		}
	}
};