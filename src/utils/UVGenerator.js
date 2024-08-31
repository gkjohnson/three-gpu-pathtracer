// https://github.com/mozilla/Spoke/commit/9701d647020e09d584885bd457eb225e9995c12f
import XAtlas from '@gfodor/xatlas-web';
import { Float32BufferAttribute, Uint32BufferAttribute } from 'three';

const AddMeshStatus = {
	Success: 0,
	Error: 1,
	IndexOutOfRange: 2,
	InvalidIndexCount: 3
};

export class UVGenerator {

	constructor( wasmPath = new URL( '../../node_modules/@gfodor/xatlas-web/dist/xatlas-web.wasm', import.meta.url ) ) {

		this._module = null;
		this._wasmPath = wasmPath;

		this.channel = 1;

	}

	async init() {

		if ( this._module ) return;

		const wasmurl = new URL( this._wasmPath, import.meta.url );
		this._module = XAtlas( {

			locateFile( path ) {

				if ( path.endsWith( '.wasm' ) ) {

					return wasmurl.toString();

				}

				return path;

			}

		} );

		this._xatlas = await this._module;

	}

	generate( geometries, onProgress = null ) {

		if ( geometries.constructor !== Array ) {

			geometries = [ geometries ];

		}

		const xatlas = this._xatlas;
		xatlas.createAtlas( );

		const meshInfos = [];

		for ( let i = 0; i < geometries.length; i ++ ) {

			const geometry = geometries[ i ];

			const originalVertexCount = geometry.attributes.position.count;
			const originalIndexCount = geometry.index.count;

			const meshInfo = xatlas.createMesh( originalVertexCount, originalIndexCount, true, true );
			xatlas.HEAPU32.set( geometry.index.array, meshInfo.indexOffset / Uint32Array.BYTES_PER_ELEMENT );
			xatlas.HEAPF32.set( geometry.attributes.position.array, meshInfo.positionOffset / Float32Array.BYTES_PER_ELEMENT );
			xatlas.HEAPF32.set( geometry.attributes.normal.array, meshInfo.normalOffset / Float32Array.BYTES_PER_ELEMENT );

			if ( geometry.attributes.uv ) {

				xatlas.HEAPF32.set( geometry.attributes.uv.array, meshInfo.uvOffset / Float32Array.BYTES_PER_ELEMENT );

			} else {

				const vertCount = geometry.attributes.position.count;
				geometry.setAttribute( 'uv', new Float32BufferAttribute( new Float32Array( vertCount * 2 ), 2, false ) );

			}

			const statusCode = xatlas.addMesh();
			if ( statusCode !== AddMeshStatus.Success ) {

				throw new Error( `UVGenerator: Error adding mesh. Status code ${ statusCode }` );

			}

			meshInfos.push( meshInfo );

		}

		const params = { padding: 2 };
		if ( onProgress ) {

			params.onProgress = onProgress;

		}

		xatlas.generateAtlas( params );

		for ( let i = 0; i < geometries.length; i ++ ) {

			const geometry = geometries[ i ];
			const meshInfo = meshInfos[ i ];

			const meshData = xatlas.getMeshData( meshInfo.meshId );
			const oldPositionArray = geometry.attributes.position.array;
			const oldNormalArray = geometry.attributes.normal.array;
			const oldUvArray = geometry.attributes.uv.array;
			const oldColorArray = geometry.attributes.color ? geometry.attributes.color.array : null;

			const newPositionArray = new Float32Array( meshData.newVertexCount * 3 );
			const newNormalArray = new Float32Array( meshData.newVertexCount * 3 );
			const newColorArray = oldColorArray ? new Float32Array( meshData.newVertexCount * 3 ) : null;

			let newUvArray = null, newUv2Array = null;
			const useSecondChannel = this.channel === 2;

			if ( useSecondChannel ) {

				newUvArray = new Float32Array( meshData.newVertexCount * 2 );
				newUv2Array = new Float32Array( xatlas.HEAPF32.buffer, meshData.uvOffset, meshData.newVertexCount * 2 );

			} else {

				newUvArray = new Float32Array( xatlas.HEAPF32.buffer, meshData.uvOffset, meshData.newVertexCount * 2 );

			}

			const newIndexArray = new Uint32Array( xatlas.HEAPU32.buffer, meshData.indexOffset, meshData.newIndexCount );
			const originalIndexArray = new Uint32Array(
				xatlas.HEAPU32.buffer,
				meshData.originalIndexOffset,
				meshData.newVertexCount
			);

			for ( let i = 0; i < meshData.newVertexCount; i ++ ) {

				const originalIndex = originalIndexArray[ i ];
				newPositionArray[ i * 3 ] = oldPositionArray[ originalIndex * 3 ];
				newPositionArray[ i * 3 + 1 ] = oldPositionArray[ originalIndex * 3 + 1 ];
				newPositionArray[ i * 3 + 2 ] = oldPositionArray[ originalIndex * 3 + 2 ];
				newNormalArray[ i * 3 ] = oldNormalArray[ originalIndex * 3 ];
				newNormalArray[ i * 3 + 1 ] = oldNormalArray[ originalIndex * 3 + 1 ];
				newNormalArray[ i * 3 + 2 ] = oldNormalArray[ originalIndex * 3 + 2 ];

				if ( oldColorArray ) {

					newColorArray[ i * 3 ] = oldColorArray[ originalIndex * 3 ];
					newColorArray[ i * 3 + 1 ] = oldColorArray[ originalIndex * 3 + 1 ];
					newColorArray[ i * 3 + 2 ] = oldColorArray[ originalIndex * 3 + 2 ];

				}

				if ( useSecondChannel ) {

					newUvArray[ i * 2 ] = oldUvArray[ originalIndex * 2 ];
					newUvArray[ i * 2 + 1 ] = oldUvArray[ originalIndex * 2 + 1 ];

				}

			}

			geometry.setAttribute( 'position', new Float32BufferAttribute( newPositionArray, 3 ) );
			geometry.setAttribute( 'normal', new Float32BufferAttribute( newNormalArray, 3 ) );
			geometry.setAttribute( 'uv', new Float32BufferAttribute( newUvArray, 2 ) );

			if ( newColorArray ) {

				geometry.setAttribute( 'color', new Float32BufferAttribute( newColorArray, 3 ) );

			}

			if ( newUv2Array ) {

				geometry.setAttribute( 'uv2', new Float32BufferAttribute( newUv2Array, 2 ) );

			}

			geometry.setIndex( new Uint32BufferAttribute( newIndexArray, 1 ) );

		}

		xatlas.destroyAtlas();

	}

}
