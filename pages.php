<?php

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

// database configuration
$ROOT_PATH = ''; // TODO: add your database path here
$DB_CODE_MAKER_PATH = $ROOT_PATH . 'codemaker.sqlite3';
$DB_CODE_MAKER = null;

$DEBUG = false; // ensure this is false for actual deployment

$DEFAULT_ERROR_MESSAGE = 'query error'; // a generic error message

$ALLOWED_PAGEKEY_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

$GRID_SCALE = 21; // always 21mm, until we enable QR code resizing (if at all...)

// --------------------------------------------------------------------------------------------------------------------
if ($DEBUG) {
	ini_set('display_errors', 1);
	error_reporting(E_ALL);
}

$PAGE_TYPES = array(
	0, // undefined
	1, // TicQR
	2  // PaperChains
);

// returns the database object
function getCodeMakerDB() {
	global $DB_CODE_MAKER;
	if (!$DB_CODE_MAKER || empty($DB_CODE_MAKER)) {
		try {
			global $DB_CODE_MAKER_PATH;
			$DB_CODE_MAKER = new PDO('sqlite:/' . $DB_CODE_MAKER_PATH);
			if (!$DB_CODE_MAKER) {
				$DB_CODE_MAKER = null;
			}
		} catch (PDOException $e) {
			$DB_CODE_MAKER = null;
		}
	}
	return $DB_CODE_MAKER;
}

// initialise the database
function initialiseCodeMakerDB() {
	exit; // (NOTE: exit)

	global $DEBUG;
	if (!$DEBUG) {
		exit;
	}

	$db = getCodeMakerDB();
	if (empty($db)) {
		return; // database error
	}

	$db->beginTransaction();
	$db->exec('CREATE TABLE pages (
					id INTEGER PRIMARY KEY,
					width INTEGER NOT NULL,
					height INTEGER NOT NULL,
					leftCodeX INTEGER NOT NULL,
					leftCodeY INTEGER NOT NULL,
					rightCodeX INTEGER NOT NULL,
					rightCodeY INTEGER NOT NULL,
					type INTEGER NOT NULL,
					locked INTEGER NOT NULL,
					dateCreated INTEGER NOT NULL,
					dateModified INTEGER NOT NULL
				)');

	$db->exec('CREATE TABLE tickboxes (
					id INTEGER PRIMARY KEY,
					pageId INTEGER NOT NULL,
					x INTEGER NOT NULL,
					y INTEGER NOT NULL,
					description TEXT NOT NULL,
					quantity INTEGER NOT NULL,
					deleted INTEGER NOT NULL,
					dateCreated INTEGER NOT NULL,
					dateModified INTEGER NOT NULL
				)');
	$db->query('CREATE INDEX tickboxes_index ON tickboxes(pageId)');

	$db->exec('CREATE TABLE audioareas (
					id INTEGER PRIMARY KEY,
					pageId INTEGER NOT NULL,
					left INTEGER NOT NULL,
					top INTEGER NOT NULL,
					right TEXT NOT NULL,
					bottom INTEGER NOT NULL,
					soundCloudId INTEGER NOT NULL,
					deleted INTEGER NOT NULL,
					dateCreated INTEGER NOT NULL,
					dateModified INTEGER NOT NULL
				)');
	$db->query('CREATE INDEX audioareas_index ON audioareas(pageId)');

	$db->exec('CREATE TABLE destinations (
				id INTEGER PRIMARY KEY,
				pageId INTEGER NOT NULL,
				destination TEXT NOT NULL
			)');
	$db->query('CREATE INDEX destinations_index ON destinations(pageId)');
	$db->commit();

	$db->exec('VACUUM DB'); // clear up space from old records

	echo getErrorJSON('database initialised successfully');
}

// returns a JSON-formatted error message, or $DEFAULT_ERROR_MESSAGE if debugging is turned off
function getErrorJSON($message) {
	global $DEBUG, $DEFAULT_ERROR_MESSAGE;
	$error = array(
		'status' => 'fail',
		'reason' => $DEBUG ? $message : $DEFAULT_ERROR_MESSAGE
	);
	return json_encode($error);
}

// wrap a JSON response in the requested callback (if the callback is valid)
function wrapCallback($json) {
	if (isset($_GET['callback']) && isValidCallback($_GET['callback'])) {
		$cancelError = '';
		if (isset($_GET['success']) && isValidCallback($_GET['success'])) {
			$connectionId = intval($_GET['id']);
			$cancelError = htmlspecialchars($_GET['success']) . '(' . $connectionId . ');';
		}
		return $cancelError . htmlspecialchars($_GET['callback']) . '(' . $json . ');';
	}
	return $json;
}

function isValidPageType($type) {
	global $PAGE_TYPES;
	return in_array($type, $PAGE_TYPES);
}

// check JSONP name for validity/security/
function isValidCallback($callback) {
	// see: http://tav.espians.com/sanitising-jsonp-callback-identifiers-for-security.html
	$reserved = array('break', 'do', 'instanceof', 'typeof', 'case', 'else', 'new', 'var', 'catch', 'finally', 'return', 'void', 'continue', 'for', 'switch', 'while', 'debugger', 'function', 'this', 'with', 'default', 'if', 'throw', 'delete', 'in', 'try', 'class', 'enum', 'extends', 'super', 'const', 'export', 'import', 'implements', 'let', 'private', 'public', 'yield', 'interface', 'package', 'protected', 'static', 'null', 'true', 'false');
	foreach(explode('.', $callback) as $identifier) {
		if(!preg_match('/^[a-zA-Z_$][0-9a-zA-Z_$]*(?:\[(?:".+"|\'.+\'|\d+)\])*?$/', $identifier)) {
			return false;
		}
		if(in_array($identifier, $reserved)) {
			return false;
		}
	}
    return true;
}

// checks whether a value is an integer, and positive
// TODO: check against size limits, too?
function isPositiveOrZeroInteger($value) {
	return ((is_numeric($value) && ((string)(int)$value === ltrim((string)$value, '-')) && ((int)$value >= 0)));
}

// checks whether a value is an integer (positive or negative)
// TODO: check against size limits, too?
function isInteger($value) {
	return ((is_numeric($value) && ((string)(int)$value === (string)$value)));
}

// get current time in milliseconds (see: http://stackoverflow.com/a/3656934)
function millitime() {
	$microtime = microtime();
	$comps = explode(' ', $microtime);

	// we use a string here to prevent loss of precision in case of overflow (PHP converts it to a double)
	return sprintf('%d%03d', $comps[1], $comps[0] * 1000);
}

// convert a page's database row ID to a unique page key
// see: http://briancray.com/posts/free-php-url-shortener-script/
function getPageKeyFromID($integer) {
	global $ALLOWED_PAGEKEY_CHARS;
	$length = strlen($ALLOWED_PAGEKEY_CHARS);
	$out = null;
	while($integer > $length - 1) {
		$out = $ALLOWED_PAGEKEY_CHARS[fmod($integer, $length)] . $out;
		$integer = floor( $integer / $length );
	}
	return $ALLOWED_PAGEKEY_CHARS[$integer] . $out;
}

// convert a pageKey to the database row ID that it represents
function getIDFromPageKey($string) {
	global $ALLOWED_PAGEKEY_CHARS;
	$length = strlen($ALLOWED_PAGEKEY_CHARS);
	$size = strlen($string) - 1;
	$string = str_split($string);
	$out = strpos($ALLOWED_PAGEKEY_CHARS, array_pop($string));
	foreach($string as $i => $char) {
		$out += strpos($ALLOWED_PAGEKEY_CHARS, $char) * pow($length, $size - $i);
	}
	return $out;
}

// --------------------------------------------------------------------------------------------------------------------
// get a page's information from the database (note: page only; not associated content)
function getPageFromDB($pageId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return null; // database error
	}

	$statement = $db->prepare('SELECT id as pageKey, * FROM pages WHERE id == :pageId');
	if ($statement !== false) {
		$statement->bindParam(':pageId', $pageId);
		if ($statement->execute()) {
			if ($row = $statement->fetch(PDO::FETCH_ASSOC)) {
				$row['pageKey'] = getPageKeyFromID($row['pageKey']);
				$row['locked'] = ($row['locked'] == 1) ? true : false; // == instead of === is intentional (not an int)
				unset($row['id']);
				return $row;
			}
		}
	}

	return null;
}

// save (or update) a page in the database
function savePageToDB($pageId, $width, $height, $leftCodeX, $leftCodeY, $rightCodeX, $rightCodeY) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return getErrorJSON('database error'); // database error
	}

	$result = array(
		'status' => 'fail',
		'reason' => 'invalid'
	);

	// create an update or insert statement depending on whether the page already exists
	$newRow = $pageId === false;
	if (!$newRow) {
		$currentPage = getPageFromDB($pageId);
		if (empty($currentPage)) {
			$result['reason'] = 'page not found';
			return json_encode($result);
		} else if ($currentPage['locked'] !== false) {
			$result['reason'] = 'the page is locked';
			return json_encode($result);
		}
	}

	$statement = false;
	$currentTime = millitime();
	if ($newRow) {
		$statement = $db->prepare('INSERT INTO pages (width, height, leftCodeX, leftCodeY, rightCodeX, rightCodeY, type, locked, dateCreated, dateModified) VALUES (:width, :height, :leftCodeX, :leftCodeY, :rightCodeX, :rightCodeY, 0, 0, :dateCreated, :dateModified)');
		if ($statement !== false) {
			$statement->bindParam(':dateCreated', $currentTime);
		}
	} else {
		$statement= $db->prepare('UPDATE pages SET width = :width, height = :height, leftCodeX = :leftCodeX, leftCodeY = :leftCodeY, rightCodeX = :rightCodeX, rightCodeY = :rightCodeY, dateModified = :dateModified WHERE id == :pageId AND locked == 0');
		if ($statement !== false) {
			$statement->bindParam(':pageId', $pageId);
		}
	}
	if ($statement !== false) {
		$db->beginTransaction();
		$statement->bindParam(':width', intval($width));
		$statement->bindParam(':height', intval($height));
		$statement->bindParam(':leftCodeX', intval($leftCodeX));
		$statement->bindParam(':leftCodeY', intval($leftCodeY));
		$statement->bindParam(':rightCodeX', intval($rightCodeX));
		$statement->bindParam(':rightCodeY', intval($rightCodeY));
		$statement->bindParam(':dateModified', $currentTime);
		if ($statement->execute()) {
			$result['status'] = 'ok';
			unset($result['reason']);
			if ($newRow) {
				$result['pageKey'] = getPageKeyFromID($db->lastInsertId('id'));
			} else {
				$result['pageKey'] = getPageKeyFromID($pageId);
			}
		}
		$db->commit();
	}
	return json_encode($result);
}

// lock a page in the database (we assume the page exists)
function lockPageInDB($pageId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return false;
	}

	$success = false;
	$statement= $db->prepare('UPDATE pages SET locked = 1 WHERE id == :pageId');
	if ($statement !== false) {
		$db->beginTransaction();
		$statement->bindParam(':pageId', $pageId);
		if ($statement->execute()) {
			$success = true;
		}
		$db->commit();
	}
	return $success;
}

// change a page's type (see $PAGE_TYPES)
function updatePageType($pageId, $type) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return getErrorJSON('database error');
	}

	$result = array(
		'status' => 'fail',
		'reason' => 'invalid'
	);

	if (!isValidPageType($type)) {
		$result['reason'] = 'invalid page type';
		return json_encode($result);
	}

	$currentPage = getPageFromDB($pageId);
	if (empty($currentPage)) {
		$result['reason'] = 'page not found';
		return json_encode($result);
	} else if ($currentPage['locked'] !== false) {
		$result['reason'] = 'the page is locked';
		return json_encode($result);
	}

	$currentTime = millitime();
	$statement = $db->prepare('UPDATE pages SET type = :type, dateModified = :dateModified WHERE id == :pageId AND locked == 0');
	if ($statement !== false) {
		$db->beginTransaction();
		$statement->bindParam(':pageId', $pageId);
		$statement->bindParam(':type', $type);
		$statement->bindParam(':dateModified', $currentTime);
		if ($statement->execute()) {
			$result['status'] = 'ok';
			unset($result['reason']);
			$result['pageKey'] = getPageKeyFromID($pageId);
		}
		$db->commit();
	}
	return json_encode($result);
}

// get all tickboxes associated with a particular page
function getTickBoxesFromDB($pageId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return null; // database error
	}

	$statement = $db->prepare('SELECT * FROM tickboxes WHERE pageId == :pageId and deleted == 0');
	if ($statement !== false) {
		$statement->bindParam(':pageId', $pageId);
		if ($statement->execute()) {
			if ($boxes = $statement->fetchAll(PDO::FETCH_ASSOC)) {
				return $boxes;
			}
		}
	}

	return null;
}

// get a single tickbox by box ID
function getSingleTickBoxFromDB($boxId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return null; // database error
	}

	$statement = $db->prepare('SELECT * FROM tickboxes WHERE id == :boxId and deleted == 0');
	if ($statement !== false) {
		$statement->bindParam(':boxId', intval($boxId));
		if ($statement->execute()) {
			if ($box = $statement->fetch(PDO::FETCH_ASSOC)) {
				return $box;
			}
		}
	}

	return null;
}

// save (or update) a tickbox
function saveTickBoxToDB($boxId, $pageId, $x, $y, $description, $quantity, $tempId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return getErrorJSON('database error');
	}

	$result = array(
		'status' => 'fail',
		'reason' => 'invalid'
	);

	$currentPage = getPageFromDB($pageId);
	if (empty($currentPage)) {
		$result['reason'] = 'page not found';
		return json_encode($result);
	} else if ($currentPage['type'] != 1) { // != rather than !== intentionally (not an int)
		$result['reason'] = 'incorrect page type';
		return json_encode($result);
	} else if ($currentPage['locked'] !== false) {
		$result['reason'] = 'the page is locked';
		return json_encode($result);
	}

	// create an update or insert statement depending on whether the page already exists
	$newRow = $boxId === false;
	if (!$newRow) {
		$currentBox = getSingleTickBoxFromDB($boxId);
		if ($currentBox === null) {
			$result['reason'] = 'box not found';
			return json_encode($result);
		} else if ($currentBox['pageId'] != $pageId) { // != instead of !== is intentional (not an int)
			$result['reason'] = 'incorrect page id';
			return json_encode($result);
		}
	}

	$statement = false;
	$currentTime = millitime();
	if ($newRow) {
		$statement = $db->prepare('INSERT INTO tickboxes (pageId, x, y, description, quantity, deleted, dateCreated, dateModified) VALUES (:pageId, :x, :y, :description, :quantity, 0, :dateCreated, :dateModified)');
		if ($statement !== false) {
			// default to empty description and quantity of 1
			$description = ($description !== false) ? $description : '';
			$quantity = ($quantity !== false) ? intval($quantity) : 1;
			$statement->bindParam(':description', $description);
			$statement->bindParam(':quantity', $quantity);
			$statement->bindParam(':dateCreated', $currentTime);
		}
	} else {
		$updateDescriptionAndQuantity = ($description !== false) && ($quantity !== false);
		if ($updateDescriptionAndQuantity) {
			$statement = $db->prepare('UPDATE tickboxes SET x = :x, y = :y, description = :description, quantity = :quantity, dateModified = :dateModified WHERE id == :boxId AND pageId == :pageId');
			if ($statement !== false) {
				$statement->bindParam(':description', $description);
				$statement->bindParam(':quantity', intval($quantity));
			}
		} else {
			$statement= $db->prepare('UPDATE tickboxes SET x = :x, y = :y, dateModified = :dateModified WHERE id == :boxId AND pageId == :pageId');
		}
		if ($statement !== false) {
			$statement->bindParam(':boxId', $boxId);
		}
	}
	if ($statement !== false) {
		$db->beginTransaction();
		$statement->bindParam(':x', intval($x));
		$statement->bindParam(':y', intval($y));
		$statement->bindParam(':dateModified', $currentTime);
		$statement->bindParam(':pageId', $pageId);
		if ($statement->execute()) {
			$result['status'] = 'ok';
			unset($result['reason']);
			if ($newRow) {
				$result['id'] = $db->lastInsertId('id');
			} else {
				$result['id'] = $boxId;
			}

			// because of JSONP, tickbox creation needs to search through existing boxes to add the ID to the right box
			if ($tempId !== false) {
				$result['tempId'] = intval($tempId);
				$result['x'] = intval($x);
				$result['y'] = intval($y);
			}
		}
		$db->commit();
	}
	return json_encode($result);
}

// delete a tickbox (marks as deleted, rather than actually deleting)
function deleteTickBoxFromDB($boxId, $pageId) {
	// TODO: this and the save/add code duplicate lots of checking logic - extract to a function
	$db = getCodeMakerDB();
	if (empty($db)) {
		return getErrorJSON('database error');
	}

	$result = array(
		'status' => 'fail',
		'reason' => 'invalid'
	);

	$currentPage = getPageFromDB($pageId);
	if (empty($currentPage)) {
		$result['reason'] = 'page not found';
		return json_encode($result);
	} else if ($currentPage['type'] != 1) { // != rather than !== intentionally (not an int)
		$result['reason'] = 'incorrect page type';
		return json_encode($result);
	} else if ($currentPage['locked'] !== false) {
		$result['reason'] = 'the page is locked';
		return json_encode($result);
	}

	$currentBox = getSingleTickBoxFromDB($boxId);
	if ($currentBox === null) {
		$result['reason'] = 'box not found';
		return json_encode($result);
	} else if ($currentBox['pageId'] != $pageId) { // != instead of !== is intentional (not an int)
		$result['reason'] = 'incorrect page id';
		return json_encode($result);
	}

	$statement= $db->prepare('UPDATE tickboxes SET deleted = 1, dateModified = :dateModified WHERE id == :boxId AND pageId == :pageId');
	if ($statement !== false) {
		$currentTime = millitime();
		$db->beginTransaction();
		$statement->bindParam(':dateModified', $currentTime);
		$statement->bindParam(':boxId', $boxId);
		$statement->bindParam(':pageId', $pageId);
		if ($statement->execute()) {
			$result['status'] = 'ok';
			unset($result['reason']);
			$result['id'] = $boxId;
		}
		$db->commit();
	}
	return json_encode($result);
}

// get a page's destination
function getDestinationFromDB($pageId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return null; // database error
	}

	$statement = $db->prepare('SELECT destination FROM destinations WHERE pageId == :pageId');
	if ($statement !== false) {
		$statement->bindParam(':pageId', $pageId);
		if ($statement->execute()) {
			if ($row = $statement->fetch(PDO::FETCH_ASSOC)) {
				return $row['destination'];
			}
		}
	}

	return null;
}

// change the destination of TicQR-type pages (deletes any existing entries)
function updatePageDestination($pageId, $destination) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return getErrorJSON('database error'); // database error
	}

	$result = array(
		'status' => 'fail',
		'reason' => 'invalid'
	);

	$currentPage = getPageFromDB($pageId);
	if (empty($currentPage)) {
		$result['reason'] = 'page not found';
		return json_encode($result);
	} else if ($currentPage['type'] != 1) { // != rather than !== intentionally (not an int)
		$result['reason'] = 'incorrect page type';
		return json_encode($result);
	} else if ($currentPage['locked'] !== false) {
		$result['reason'] = 'the page is locked';
		return json_encode($result);
	}

	// remove old values
	$statement = $db->prepare('DELETE FROM destinations WHERE pageId = :pageId');
	if ($statement !== false) {
		$db->beginTransaction();
		$statement->bindParam(':pageId', $pageId);
		$statement->execute();
		$db->commit();
	}

	$currentTime = millitime();
	$statement = $db->prepare('INSERT INTO destinations (pageId, destination) VALUES (:pageId, :destination)');
	if ($statement !== false) {
		$db->beginTransaction();
		$statement->bindParam(':pageId', $pageId);
		$statement->bindParam(':destination', $destination);
		if ($statement->execute()) {
			$result['status'] = 'ok';
			unset($result['reason']);
			$result['pageKey'] = getPageKeyFromID($pageId);
		}
		$db->commit();
	}
	return json_encode($result);
}

// get all audio areas associated with a particular page
function getAudioAreasFromDB($pageId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return null; // database error
	}

	$statement = $db->prepare('SELECT * FROM audioareas WHERE pageId == :pageId and deleted == 0');
	if ($statement !== false) {
		$statement->bindParam(':pageId', $pageId);
		if ($statement->execute()) {
			if ($audioareas = $statement->fetchAll(PDO::FETCH_ASSOC)) {
				return $audioareas;
			}
		}
	}

	return null;
}

// save an audio area
function saveAudioAreaToDB($pageId, $left, $top, $right, $bottom, $soundCloudId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return getErrorJSON('database error');
	}

	$result = array(
		'status' => 'fail',
		'reason' => 'invalid'
	);

	$currentPage = getPageFromDB($pageId);
	if (empty($currentPage)) {
		$result['reason'] = 'page not found';
		return json_encode($result);
	} else if ($currentPage['type'] != 2) { // != rather than !== intentionally (not an int)
		$result['reason'] = 'incorrect page type';
		return json_encode($result);
	} else if ($currentPage['locked'] !== false) {
		// it is ok to edit PaperChains documents when the page is locked
	}

	// convert to mm dimensions for storage (and codemaker display)
	global $GRID_SCALE;
	$left = round(($left * ($GRID_SCALE / 100)) + $currentPage['leftCodeX']);
	$top = round(($top * ($GRID_SCALE / 100)) + $currentPage['rightCodeY']);
	$right = round(($right * ($GRID_SCALE / 100)) + $currentPage['leftCodeX']);
	$bottom = round(($bottom * ($GRID_SCALE / 100)) + $currentPage['rightCodeY']);

	$currentTime = millitime();
	$statement = $db->prepare('INSERT INTO audioareas (pageId, left, top, right, bottom, soundCloudId, deleted, dateCreated, dateModified) VALUES (:pageId, :left, :top, :right, :bottom, :soundCloudId, 0, :dateCreated, :dateModified)');
	if ($statement !== false) {
		$db->beginTransaction();
		$statement->bindParam(':left', intval($left));
		$statement->bindParam(':top', intval($top));
		$statement->bindParam(':right', intval($right));
		$statement->bindParam(':bottom', intval($bottom));
		$statement->bindParam(':soundCloudId', $soundCloudId);
		$statement->bindParam(':dateModified', $currentTime);
		$statement->bindParam(':dateCreated', $currentTime);
		$statement->bindParam(':pageId', $pageId);
		if ($statement->execute()) {
			$result['status'] = 'ok';
			unset($result['reason']);
			$result['id'] = $db->lastInsertId('id');
		}
		$db->commit();
	}
	return json_encode($result);
}

// duplicate an existing page and all its content
function duplicatePage($pageId) {
	$db = getCodeMakerDB();
	if (empty($db)) {
		return getErrorJSON('database error');
	}

	$result = array(
		'status' => 'fail',
		'reason' => 'invalid'
	);

	$currentPage = getPageFromDB($pageId);
	if (empty($currentPage)) {
		$result['reason'] = 'page not found';
		return json_encode($result);
	}

	$newPageJson = savePageToDB(false, $currentPage['width'], $currentPage['height'], $currentPage['leftCodeX'], $currentPage['leftCodeY'], $currentPage['rightCodeX'], $currentPage['rightCodeY']);
	$newPage = json_decode($newPageJson); // TODO: avoid this unnecessary encoding then decoding step

	$newPageId = getIDFromPageKey($newPage->{'pageKey'});
	updatePageType($newPageId, $currentPage['type']);

	// duplicate existing page items
	if ($currentPage['type'] == 1) {
		$tickBoxes = getTickBoxesFromDB($pageId);
		if (!empty($tickBoxes)) {
			foreach ($tickBoxes as $box) {
				saveTickBoxToDB(false, $newPageId, $box['x'], $box['y'], $box['description'], $box['quantity'], false);
			}
		}
		$pageDestination = getDestinationFromDB($pageId);
		if (!empty($pageDestination)) {
			updatePageDestination($newPageId, $pageDestination);
		}

	} else if ($currentPage['type'] == 2) {
		// TODO: should we really duplicate audio areas?
		$audioAreas = getAudioAreasFromDB($pageId);
		if (!empty($audioAreas)) {
			foreach ($audioAreas as $area) {
				saveAudioAreaToDB($newPageId, $area['left'], $area['top'], $area['right'], $area['bottom'], $area['soundCloudId']);
			}
		}
	} else {
		// type unknown - nothing to do
	}

	return lookupPageDetails($newPageId);
}

// return all the details required for a complete page (all TicQR and PaperChains elements, depending on page type)
function lookupPageDetails($pageId, $scalePageElements = false, $lockIfExists = false) {
	$page = getPageFromDB($pageId);
	if (!empty($page)) {
		if ($lockIfExists) {
			// don't lock if the page type is not yet set (still editing)
			if ($page['type'] != 0) {
				lockPageInDB($pageId); // returns true/false so can check if necessary
				$page['locked'] = true;
			}
		}

		global $GRID_SCALE;

		if ($page['type'] == 1) {
			$tickBoxes = getTickBoxesFromDB($pageId);
			if (!empty($tickBoxes)) {
				foreach ($tickBoxes as &$box) {
					unset($box['pageId']); // don't need page id (it is the numeric value, rather than pageKey form)
					if ($scalePageElements) {
						$box['x'] = round(($box['x'] - $page['leftCodeX']) / ($GRID_SCALE / 100));
						$box['y'] = round(($box['y'] - $page['rightCodeY']) / ($GRID_SCALE / 100));
					}
				}
				unset($box);
				$page['tickBoxes'] = $tickBoxes;
				$page['destination'] = getDestinationFromDB($pageId);
			} else {
				$page['tickBoxes'] = array();
			}

		} else if ($page['type'] == 2) {
			$audioAreas = getAudioAreasFromDB($pageId);
			if (!empty($audioAreas)) {
				foreach ($audioAreas as &$area) {
					unset($area['pageId']); // don't need page id (it is the numeric value, rather than pageKey form)
					if ($scalePageElements) {
						$area['left'] = round(($area['left'] - $page['leftCodeX']) / ($GRID_SCALE / 100));
						$area['top'] = round(($area['top'] - $page['rightCodeY']) / ($GRID_SCALE / 100));
						$area['right'] = round(($area['right'] - $page['leftCodeX']) / ($GRID_SCALE / 100));
						$area['bottom'] = round(($area['bottom'] - $page['rightCodeY']) / ($GRID_SCALE / 100));
					}
				}
				unset($area);
				$page['audioAreas'] = $audioAreas;
			} else {
				$page['audioAreas'] = array();
			}

		} else {
			// type unknown
		}

		$page['status'] = 'ok';
		return json_encode($page);
	}

	return getErrorJSON('pagekey not found');
}

// --------------------------------------------------------------------------------------------------------------------
// handle requests
header('Content-Type: application/json');
if (isset($_GET['edit'])) {
	// look up a page - returns the dimensions and all its tick boxes / audio areas
	$query = $_GET['edit'];
	if (!empty($query)) {
		echo wrapCallback(lookupPageDetails(getIDFromPageKey($query)));
	} else {
		echo wrapCallback(getErrorJSON('pagekey not specified'));
	}

} else if (isset($_GET['lookup'])) {
	// look up a page - returns the dimensions and all its tick boxes / audio areas
	// this is no different from the standard lookup, except that it locks the page so no further edits can be made
	// (but will not lock if the page type is not yet set)
	$query = $_GET['lookup'];
	if (!empty($query)) {
		echo wrapCallback(lookupPageDetails(getIDFromPageKey($query), true, true));
	} else {
		echo wrapCallback(getErrorJSON('pagekey not specified'));
	}

} else if (isset($_GET['new']) || isset($_GET['update'])) {
	// create a new page, or update an existing page
	$width = isset($_GET['width']) ? $_GET['width'] : false;
	$height = isset($_GET['height']) ? $_GET['height'] : false;
	$leftCodeX = isset($_GET['leftCodeX']) ? $_GET['leftCodeX'] : false;
	$leftCodeY = isset($_GET['leftCodeY']) ? $_GET['leftCodeY'] : false;
	$rightCodeX = isset($_GET['rightCodeX']) ? $_GET['rightCodeX'] : false;
	$rightCodeY = isset($_GET['rightCodeY']) ? $_GET['rightCodeY'] : false;
	if (isPositiveOrZeroInteger($width) && isPositiveOrZeroInteger($height) &&
			isPositiveOrZeroInteger($leftCodeX) && isPositiveOrZeroInteger($leftCodeY) &&
			isPositiveOrZeroInteger($rightCodeX) && isPositiveOrZeroInteger($rightCodeY)) {
		$pageId = isset($_GET['update']) ? getIDFromPageKey($_GET['update']) : false;
		echo wrapCallback(savePageToDB($pageId, $width, $height, $leftCodeX, $leftCodeY, $rightCodeX, $rightCodeY));
	} else {
		echo wrapCallback(getErrorJSON('new/update page attribute invalid or missing'));
	}

} else if (isset($_GET['updatedestination'])) {
	// change a page's email address
	$pageId = isset($_GET['updatedestination']) ? getIDFromPageKey($_GET['updatedestination']) : false;
	$destination = isset($_GET['destination']) ? $_GET['destination'] : false;
	if (isPositiveOrZeroInteger($pageId) && $destination !== false) {
		echo wrapCallback(updatePageDestination($pageId, $destination));
	} else {
		echo wrapCallback(getErrorJSON('update destination attribute invalid or missing'));
	}

} else if (isset($_GET['updatetype'])) {
	// change the type of a page
	$pageId = isset($_GET['updatetype']) ? getIDFromPageKey($_GET['updatetype']) : false;
	$type = isset($_GET['type']) ? $_GET['type'] : false;
	if (isPositiveOrZeroInteger($pageId) && isPositiveOrZeroInteger($type)) {
		echo wrapCallback(updatePageType($pageId, $type));
	} else {
		echo wrapCallback(getErrorJSON('update destination attribute invalid or missing'));
	}

} else if (isset($_GET['newbox']) || isset($_GET['updatebox'])) {
	// create a new tickbox, or update an existing tickbox
	$x = isset($_GET['x']) ? $_GET['x'] : false;
	$y = isset($_GET['y']) ? $_GET['y'] : false;
	$description = isset($_GET['description']) ? $_GET['description'] : false;
	$quantity = isset($_GET['quantity']) ? $_GET['quantity'] : false;
	$tempId = isset($_GET['tempId']) ? $_GET['tempId'] : false; // for box tracking before real id
	$pageId = isset($_GET['page']) ? getIDFromPageKey($_GET['page']) : false;
	if (isPositiveOrZeroInteger($x) && isPositiveOrZeroInteger($y) && isPositiveOrZeroInteger($pageId)) {
		$boxId = isset($_GET['updatebox']) ? $_GET['updatebox'] : false;
		echo wrapCallback(saveTickBoxToDB($boxId, $pageId, $x, $y, $description, $quantity, $tempId));
	} else {
		echo wrapCallback(getErrorJSON('new/update tickbox attribute invalid or missing'));
	}

} else if (isset($_GET['deletebox'])) {
	// delete a tickbox
	$boxId = isset($_GET['deletebox']) ? $_GET['deletebox'] : false;
	$pageId = isset($_GET['page']) ? getIDFromPageKey($_GET['page']) : false;
	if (isPositiveOrZeroInteger($boxId) && isPositiveOrZeroInteger($pageId)) {
		echo wrapCallback(deleteTickBoxFromDB($boxId, $pageId));
	} else {
		echo wrapCallback(getErrorJSON('delete tickbox attribute invalid or missing'));
	}

} else if (isset($_GET['newaudio'])) {
	// add an audio item
	$left = isset($_GET['left']) ? $_GET['left'] : false;
	$top = isset($_GET['top']) ? $_GET['top'] : false;
	$right = isset($_GET['right']) ? $_GET['right'] : false;
	$bottom = isset($_GET['bottom']) ? $_GET['bottom'] : false;
	$soundCloudId = isset($_GET['soundCloudId']) ? $_GET['soundCloudId'] : false;
	$pageId = isset($_GET['pageId']) ? getIDFromPageKey($_GET['pageId']) : false;
	if (isInteger($left) && isInteger($top) && isPositiveOrZeroInteger($right) && isPositiveOrZeroInteger($bottom) &&
			isPositiveOrZeroInteger($pageId)) {
		// for enhanced interaction in PaperChains we allow negative values and those outside page areas
		echo wrapCallback(saveAudioAreaToDB($pageId, $left, $top, $right, $bottom, $soundCloudId));
	} else {
		echo wrapCallback(getErrorJSON('add audio area attribute invalid or missing'));
	}

} else if (isset($_GET['duplicate'])) {
	// duplicate an entire page (and all its content)
	$pageId = isset($_GET['duplicate']) ? getIDFromPageKey($_GET['duplicate']) : false;
	if (isPositiveOrZeroInteger($pageId)) {
		echo wrapCallback(duplicatePage($pageId));
	} else {
		echo wrapCallback(getErrorJSON('duplicate page attribute invalid or missing'));
	}

} else {
	echo wrapCallback(getErrorJSON('no query specified'));
}

?>