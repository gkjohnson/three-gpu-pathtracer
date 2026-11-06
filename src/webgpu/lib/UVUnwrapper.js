/** @import { Object3D } from 'three' */
import { BufferAttribute, Matrix3, Vector3 } from 'three';
import * as watlas from 'watlas';

const _vec = /* @__PURE__ */ new Vector3();
const _normalMatrix = /* @__PURE__ */ new Matrix3();

/**
 * Unwraps meshes into one shared uv atlas with xatlas, measured in world space. Each mesh gets a new
 * geometry with the atlas in its "uv1" attribute, like three.js' "unwrapUVs".
 */
export class UVUnwrapper {

	constructor() {

		/**
		 * Atlas size in texels.
		 * @type {number}
		 */
		this.resolution = 1024;

		/**
		 * Texels between charts.
		 * @type {number}
		 */
		this.padding = 2;

		/**
		 * Keep the charts of the "uv" attribute and only pack them.
		 * @type {boolean}
		 */
		this.useInputUVs = false;

	}

	/**
	 * Gives every mesh under the root a new geometry with the atlas in "uv1". Throws if the charts do not
	 * fit one atlas.
	 *
	 * @param {Object3D} root - A mesh or hierarchy to unwrap.
	 * @returns {Promise<void>}
	 */
	async generate( root ) {

		const { resolution, padding, useInputUVs } = this;

		const meshes = [];
		root.traverse( c => {

			if ( c.isMesh ) {

				meshes.push( c );

			}

		} );

		await watlas.Initialize();

		const atlas = new watlas.Atlas();
		for ( const mesh of meshes ) {

			mesh.updateWorldMatrix( true, false );
			_normalMatrix.getNormalMatrix( mesh.matrixWorld );

			const { geometry } = mesh;
			const position = geometry.getAttribute( 'position' );
			const normal = geometry.getAttribute( 'normal' );
			const uv = geometry.getAttribute( 'uv' );
			const index = geometry.getIndex();
			const vertexCount = position.count;

			const positionData = new Float32Array( vertexCount * 3 );
			for ( let i = 0; i < vertexCount; i ++ ) {

				_vec.fromBufferAttribute( position, i ).applyMatrix4( mesh.matrixWorld ).toArray( positionData, i * 3 );

			}

			const declaration = {
				vertexPositionData: positionData,
				vertexCount,
				vertexPositionStride: 12,
			};

			if ( normal ) {

				const normalData = new Float32Array( vertexCount * 3 );
				for ( let i = 0; i < vertexCount; i ++ ) {

					_vec.fromBufferAttribute( normal, i ).applyMatrix3( _normalMatrix ).normalize().toArray( normalData, i * 3 );

				}

				declaration.vertexNormalData = normalData;
				declaration.vertexNormalStride = 12;

			}

			if ( uv && useInputUVs ) {

				const uvData = new Float32Array( vertexCount * 2 );
				for ( let i = 0; i < vertexCount; i ++ ) {

					uvData[ i * 2 + 0 ] = uv.getX( i );
					uvData[ i * 2 + 1 ] = uv.getY( i );

				}

				declaration.vertexUvData = uvData;
				declaration.vertexUvStride = 8;

			}

			if ( index ) {

				declaration.indexData = new Uint32Array( index.array );
				declaration.indexCount = index.count;

			}

			atlas.addMesh( declaration );

		}

		atlas.generate( { useInputMeshUvs: useInputUVs }, { resolution, padding } );

		// charts that do not fit spill onto more atlases, which a single map can't hold
		if ( atlas.atlasCount > 1 ) {

			atlas.delete();
			throw new Error( 'UVUnwrapper: Charts do not fit one atlas.' );

		}

		meshes.forEach( ( mesh, i ) => {

			mesh.geometry = getAtlasGeometry( mesh.geometry, atlas, i );

		} );

		atlas.delete();

	}

}

// copies the geometry with the vertices xatlas split along the chart seams, adding the "uv1" attribute
function getAtlasGeometry( geometry, atlas, meshIndex ) {

	const mesh = atlas.getMesh( meshIndex );
	const newVertexCount = mesh.vertexCount;
	const newIndex = new Uint32Array( mesh.indexCount );
	mesh.getIndexArray( newIndex );

	const xref = new Uint32Array( newVertexCount );
	const uv1 = new Float32Array( newVertexCount * 2 );
	for ( let i = 0; i < newVertexCount; i ++ ) {

		const vertex = mesh.getVertex( i );
		xref[ i ] = vertex.xref;
		uv1[ i * 2 + 0 ] = vertex.uv[ 0 ] / atlas.width;
		uv1[ i * 2 + 1 ] = vertex.uv[ 1 ] / atlas.height;

	}

	const result = geometry.clone();
	for ( const name in geometry.attributes ) {

		const attribute = geometry.attributes[ name ];
		const itemSize = attribute.itemSize;
		const array = new attribute.array.constructor( newVertexCount * itemSize );
		for ( let i = 0; i < newVertexCount; i ++ ) {

			const src = xref[ i ] * itemSize;
			const dst = i * itemSize;
			for ( let k = 0; k < itemSize; k ++ ) {

				array[ dst + k ] = attribute.array[ src + k ];

			}

		}

		result.setAttribute( name, new BufferAttribute( array, itemSize, attribute.normalized ) );

	}

	result.setAttribute( 'uv1', new BufferAttribute( uv1, 2 ) );
	result.setIndex( new BufferAttribute( newIndex, 1 ) );

	return result;

}
