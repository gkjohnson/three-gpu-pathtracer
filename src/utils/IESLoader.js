import {
	DataTexture,
	DefaultLoadingManager,
	FileLoader,
	FloatType,
	LinearFilter,
	RedFormat,
	MathUtils
} from 'three';

function IESLoader( manager ) {

	this.manager = ( manager !== undefined ) ? manager : DefaultLoadingManager;

}

function IESLamp( text ) {

	var _self = this;

	var textArray = text.split( '\n' );

	var lineNumber = 0;
	var line;

	_self.verAngles = [ ];
	_self.horAngles = [ ];

	_self.candelaValues = [ ];

	_self.tiltData = { };
	_self.tiltData.angles = [ ];
	_self.tiltData.mulFactors = [ ];

	function textToArray( text ) {

		text = text.replace( /^\s+|\s+$/g, '' ); // remove leading or trailing spaces
		text = text.replace( /,/g, ' ' ); // replace commas with spaces
		text = text.replace( /\s\s+/g, ' ' ); // Replcae white space/tabs etc by single whitespace

		var array = text.split( ' ' );

		return array;

	}

	function readArray( count, array ) {

		while ( true ) {

			var line = textArray[ lineNumber ++ ];
			var lineData = textToArray( line );

			for ( var i = 0; i < lineData.length; ++ i ) {

				array.push( Number( lineData[ i ] ) );

			}

			if ( array.length === count )
				break;

		}

	}

	function readTilt() {

		var line = textArray[ lineNumber ++ ];
		var lineData = textToArray( line );

		_self.tiltData.lampToLumGeometry = Number( lineData[ 0 ] );

		line = textArray[ lineNumber ++ ];
		lineData = textToArray( line );

		_self.tiltData.numAngles = Number( lineData[ 0 ] );

		readArray( _self.tiltData.numAngles, _self.tiltData.angles );
		readArray( _self.tiltData.numAngles, _self.tiltData.mulFactors );

	}

	function readLampValues() {

		var values = [ ];
		readArray( 10, values );

		_self.count = Number( values[ 0 ] );
		_self.lumens = Number( values[ 1 ] );
		_self.multiplier = Number( values[ 2 ] );
		_self.numVerAngles = Number( values[ 3 ] );
		_self.numHorAngles = Number( values[ 4 ] );
		_self.gonioType = Number( values[ 5 ] );
		_self.units = Number( values[ 6 ] );
		_self.width = Number( values[ 7 ] );
		_self.length = Number( values[ 8 ] );
		_self.height = Number( values[ 9 ] );

	}

	function readLampFactors() {

		var values = [ ];
		readArray( 3, values );

		_self.ballFactor = Number( values[ 0 ] );
		_self.blpFactor = Number( values[ 1 ] );
		_self.inputWatts = Number( values[ 2 ] );

	}

	while ( true ) {

		var line = textArray[ lineNumber ++ ];

		if ( line.includes( 'TILT' ) ) {

			break;

		}

	}

	if ( !line.includes( 'NONE' ) ) {

		if ( line.includes( 'INCLUDE' ) ) {

			readTilt();

		} else {

			// TODO:: Read tilt data from a file

		}

	}

	readLampValues();

	readLampFactors();

	// Initialize candela value array
	for ( var i = 0; i < _self.numHorAngles; ++ i ) {

		_self.candelaValues.push( [ ] );

	}

	// Parse Angles
	readArray( _self.numVerAngles, _self.verAngles );
	readArray( _self.numHorAngles, _self.horAngles );

	// Parse Candela values
	for ( var i = 0; i < _self.numHorAngles; ++ i ) {

		readArray( _self.numVerAngles, _self.candelaValues[ i ] );

	}

	// Calculate actual candela values, and normalize.
	for ( var i = 0; i < _self.numHorAngles; ++ i ) {

		for ( var j = 0; j < _self.numVerAngles; ++ j ) {

			_self.candelaValues[ i ][ j ] *= _self.candelaValues[ i ][ j ] * _self.multiplier
				* _self.ballFactor * _self.blpFactor;

		}
	}

	var maxVal = -1;
	for ( var i = 0; i < _self.numHorAngles; ++ i ) {

		for ( var j = 0; j < _self.numVerAngles; ++ j ) {

			var value = _self.candelaValues[ i ][ j ];
			maxVal = maxVal < value ? value : maxVal;

		}

	}

	var bNormalize = true;
	if ( bNormalize && maxVal > 0 ) {

		for ( var i = 0; i < _self.numHorAngles; ++ i ) {

			for ( var j = 0; j < _self.numVerAngles; ++ j ) {

				_self.candelaValues[ i ] [ j ] /= maxVal;

			}

		}

	}

}

Object.assign( IESLoader.prototype, {

	_parseIESData: function ( text ) {

		var iesLamp = new IESLamp( text );

		return iesLamp;

	},

	_getIESValues: function ( iesLamp ) {

		var width = 360;
		var height = 180;
		var size = width * height;

		var data = new Float32Array( size );

		function interpolateCandelaValues( phi, theta ) {

			var phiIndex = 0, thetaIndex = 0;
			var startTheta = 0, endTheta = 0, startPhi = 0, endPhi = 0;

			for ( var i = 0; i < iesLamp.numHorAngles - 1; ++ i ) { // numHorAngles = horAngles.length-1 because of extra padding, so this wont cause an out of bounds error

				if ( theta < iesLamp.horAngles[ i + 1 ] || i == iesLamp.numHorAngles - 2 ) {

					thetaIndex = i;
					startTheta = iesLamp.horAngles[ i ];
					endTheta = iesLamp.horAngles[ i + 1 ];

					break;

				}

			}

			for ( var i = 0; i < iesLamp.numVerAngles - 1; ++ i ) {

				if ( phi < iesLamp.verAngles[ i + 1 ] || i == iesLamp.numVerAngles - 2 ) {

					phiIndex = i;
					startPhi = iesLamp.verAngles[ i ];
					endPhi = iesLamp.verAngles[ i + 1 ];

					break;

				}

			}

			var deltaTheta = endTheta - startTheta;
			var deltaPhi = endPhi - startPhi;

			if ( deltaPhi === 0 ) // Outside range
				return 0;

			var t1 = deltaTheta === 0 ? 0 : ( theta - startTheta ) / deltaTheta;
			var t2 = ( phi - startPhi ) / deltaPhi;

			var nextThetaIndex = deltaTheta === 0 ? thetaIndex : thetaIndex + 1;

			var v1 = MathUtils.lerp( iesLamp.candelaValues[ thetaIndex ][ phiIndex ], iesLamp.candelaValues[ nextThetaIndex ][ phiIndex ], t1 );
			var v2 = MathUtils.lerp( iesLamp.candelaValues[ thetaIndex ][ phiIndex + 1 ], iesLamp.candelaValues[ nextThetaIndex ][ phiIndex + 1 ], t1 );
			var v = MathUtils.lerp( v1, v2, t2 );

			return v;

		}

		var startTheta = iesLamp.horAngles[ 0 ], endTheta = iesLamp.horAngles[ iesLamp.numHorAngles - 1 ];
		for ( var i = 0; i < size; ++ i ) {

			var theta = i % width;
			var phi = Math.floor( i / width );

			if ( endTheta - startTheta !== 0 && ( theta < startTheta || theta >= endTheta ) ) { // Handle symmetry for hor angles

				theta %= endTheta * 2;
				if ( theta > endTheta )
					theta = endTheta * 2 - theta;

			}

			data[ i ] = interpolateCandelaValues( phi, theta );

		}

		return data;

	},

	load: function ( url, onLoad, onProgress, onError ) {

		var loader = new FileLoader( this.manager );
		loader.setResponseType( 'text' );

		var _self = this;

		var texture = new DataTexture( null, 360, 180, RedFormat, FloatType );
		texture.minFilter = LinearFilter;
		texture.magFilter = LinearFilter;

		loader.load( url, function ( text ) {

			var iesLamp = _self._parseIESData( text );

			texture.image.data = _self._getIESValues( iesLamp );
			texture.needsUpdate = true;

			if ( onLoad !== undefined ) {

				onLoad( texture );

			}

		}, onProgress, onError );

		return texture;

	}

} );

export { IESLoader };
