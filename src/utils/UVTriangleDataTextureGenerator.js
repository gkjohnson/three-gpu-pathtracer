import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Generates a texture in UV space that encodes triangle positions and normals, used for baking.
export class UVTriangleDataTextureGenerator {

	constructor( renderer ) {

		this._renderer = renderer;
		this._createShaders();
		this.channel = 1;

	}

	_createShaders() {

		this._vertexShader = `
						varying vec3 vPosition;
						varying vec3 vNormal;
						attribute vec3 originalPosition;
						attribute vec3 originalNormal;

						void main() {
								vPosition = originalPosition;
								vNormal = originalNormal;
								gl_Position = vec4(position.xy, 0.0, 1.0);
						}
				`;

		this._positionFragmentShader = `
						varying vec3 vPosition;

						void main() {
								gl_FragColor.rgb = vPosition;
								gl_FragColor.a = 1.0;
						}
				`;

		this._normalFragmentShader = `
						varying vec3 vNormal;

						void main() {
								gl_FragColor = vec4(normalize(vNormal), 1.0);
						}
				`;

	}

	generateTexture( geometries, renderTarget ) {

		const resolution = renderTarget.width;

		const { _vertexShader: vertexShader, _positionFragmentShader: positionFragmentShader, _normalFragmentShader: normalFragmentShader, _renderer: renderer } = this;

		if ( geometries.constructor !== Array ) {

			geometries = [ geometries ];

		}

		const positionTarget = new THREE.WebGLRenderTarget( resolution, resolution, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type: THREE.FloatType,
			colorSpace: THREE.LinearSRGBColorSpace,
		} );

		const normalTarget = new THREE.WebGLRenderTarget( resolution, resolution, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type: THREE.FloatType,
			colorSpace: THREE.LinearSRGBColorSpace,
		} );

		const positionMaterial = new THREE.ShaderMaterial( {
			vertexShader: vertexShader,
			fragmentShader: positionFragmentShader,
			side: THREE.DoubleSide
		} );

		const normalMaterial = new THREE.ShaderMaterial( {
			vertexShader: vertexShader,
			fragmentShader: normalFragmentShader,
			side: THREE.DoubleSide
		} );

		const originalRenderTarget = renderer.getRenderTarget();
		const originalViewport = renderer.getViewport( new THREE.Vector4() );
		const originalClearColor = new THREE.Color();
		const originalAutoClear = renderer.autoClear;

		renderer.getClearColor( originalClearColor );
		renderer.setClearColor( 0x000000, 0 );

		renderer.setRenderTarget( positionTarget );
		renderer.clear();

		renderer.setRenderTarget( normalTarget );
		renderer.clear();

		renderer.autoClear = false;

		for ( const geometry of geometries ) {

			const uvGeometry = this._createUVGeometry( geometry );
			const mesh = new THREE.Mesh( uvGeometry );

			// Render positions
			mesh.material = positionMaterial;
			renderer.setRenderTarget( positionTarget );
			renderer.setViewport( 0, 0, resolution, resolution );
			renderer.render( mesh, new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 ) );

			// Render normals
			mesh.material = normalMaterial;
			renderer.setRenderTarget( normalTarget );
			renderer.setViewport( 0, 0, resolution, resolution );
			renderer.render( mesh, new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 ) );

			uvGeometry.dispose();

		}

		this._combineTextures( positionTarget.texture, normalTarget.texture, renderTarget );

		// Reset renderer state
		renderer.autoClear = originalAutoClear;
		renderer.setClearColor( originalClearColor );

		renderer.setRenderTarget( originalRenderTarget );
		renderer.setViewport( originalViewport );

		// Clean up
		positionTarget.dispose();
		normalTarget.dispose();
		positionMaterial.dispose();
		normalMaterial.dispose();

	}

	_createUVGeometry( originalGeometry ) {

		const uvGeometry = new THREE.BufferGeometry();

		const positions = [];
		const originalPositions = [];
		const originalNormals = [];

		const positionAttribute = originalGeometry.attributes.position;
		const normalAttribute = originalGeometry.attributes.normal;
		const uvAttribute = originalGeometry.attributes[ this.channel === 2 ? 'uv2' : 'uv' ];

		for ( let i = 0; i < positionAttribute.count; i ++ ) {

			const u = uvAttribute.getX( i );
			const v = uvAttribute.getY( i );

			positions.push( u * 2 - 1, v * 2 - 1, - 1 );

			originalPositions.push(
				positionAttribute.getX( i ),
				positionAttribute.getY( i ),
				positionAttribute.getZ( i )
			);

			originalNormals.push(
				normalAttribute.getX( i ),
				normalAttribute.getY( i ),
				normalAttribute.getZ( i )
			);

		}

		uvGeometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
		uvGeometry.setAttribute( 'originalPosition', new THREE.Float32BufferAttribute( originalPositions, 3 ) );
		uvGeometry.setAttribute( 'originalNormal', new THREE.Float32BufferAttribute( originalNormals, 3 ) );

		if ( originalGeometry.index ) {

			uvGeometry.setIndex( originalGeometry.index );

		}

		return uvGeometry;

	}

	_combineTextures( positionTexture, normalTexture, renderTarget ) {

		const combineShader = new THREE.ShaderMaterial( {
			uniforms: {
				positionTexture: { value: positionTexture },
				normalTexture: { value: normalTexture },
			},
			vertexShader: `
								varying vec2 vUv;
								void main() {
										vUv = uv;
										gl_Position = vec4(position.xy, 0.0, 1.0);
								}
						`,
			fragmentShader: `
								uniform sampler2D positionTexture;
								uniform sampler2D normalTexture;
								varying vec2 vUv;

								void main() {
										if (vUv.y < 0.5) {
												gl_FragColor = texture2D(positionTexture, vUv * vec2(1.0, 2.0));
										} else {
												gl_FragColor = texture2D(normalTexture, vUv * vec2(1.0, 2.0) - vec2(0.0, 1.0));
										}
								}
						`
		} );

		const fsQuad = new FullScreenQuad( combineShader );
		this._renderer.setRenderTarget( renderTarget );
		fsQuad.render( this._renderer );
		fsQuad.dispose();

	}

}
