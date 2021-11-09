import { Scene, WebGLRenderer, MeshBasicMaterial, Vector2, Mesh, PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/pass.js';
import { SAH } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { PathTracingRenderer } from '../utils/PathTracingRenderer.js';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';
import { LambertPathTracingMaterial } from '../materials/LambertPathTracingMaterial.js';

const resolution = new Vector2();
export class PathTracingViewer {

    constructor() {

        this.scene = new Scene();
        this.renderer = new WebGLRenderer();
        this.fsQuad = new FullScreenQuad( new MeshBasicMaterial() );
        this.ptRenderer = new PathTracingRenderer( this.renderer );
        this.ptModel = null;
        this.ptMaterials = null;
        this.model = null;
        this.bvhGenerator = new GenerateMeshBVHWorker();
        this.camera = new PerspectiveCamera();
        this._scale = 1;
        this._nextObject = null;
        this._resizeObserver = new ResizeObserver( entries => {

            const { contentRect } = entries[ 0 ];
            this.renderer.setSize( contentRect.width, contentRect.height, false );
            this._updateSize();

        } );

        this.ptRenderer.material = new LambertPathTracingMaterial();
        this._resizeObserver.observe( this.renderer.domElement );

    }

    _updateSize() {

        const dpr = window.devicePixelRatio;
        const scale = this._scale;
        this.renderer.setPixelRatio( scale * dpr );

        this.renderer.getSize( resolution );
        this.ptRenderer.target.setSize( resolution.width * scale * dpr, resolution.height * scale * dpr )

    }

    setScale( scale ) {

        this._scale = scale;
        this._updateSize();

    }

    setModel( object ) {

        if ( this.bvhGenerator.running ) {

            this._nextObject = object;
            return;

        }

        object.updateMatrixWorld( true );

        const meshes = [];
        object.traverse( c => {

            if ( c.isMesh ) {

                meshes.push( c );

            }

        } );

        const { geometry, materials } = mergeMeshes( meshes, { attributes: [ 'position', 'normal', 'uv' ] } );
        return this
            .bvhGenerator
            .generate( geometry, { strategy: SAH, maxLeafTris: 1 } )
            .then( bvh => {

                if ( this._nextObject ) {

                    this.setModel( this._nextObject );
                    this._nextObject = null;
                    return;

                }

                if ( this.model ) {

                    this.scene.remove( this.model );

                }

                const mesh = new Mesh( geometry );
                this.scene.add( object );
                this.ptModel = mesh;
                this.ptMaterials = materials;
                this.model = object;

                const { ptRenderer } = this;
                ptRenderer.material.bvh.updateFrom( bvh );
                ptRenderer.material.normalAttribute.updateFrom( geometry.attributes.normal );
                ptRenderer.material.uvAttribute.updateFrom( geometry.attributes.uv );
                ptRenderer.material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );

           } );

    }

    setEnvironment( envMap ) {

        this.scene.environment = envMap;

    }

    init() {

        const { ptRenderer, renderer, fsQuad, camera } = this;

        const controls = new OrbitControls( camera, renderer.domElement );
        controls.addEventListener( () => {

            ptRenderer.reset();

        } );

        renderer.setAnimationLoop( () => {

            if ( this.model ) {

                camera.updateMatrixWorld();

                ptRenderer.material.cameraWorldMatrix.copy( camera.matrixWorld );
                ptRenderer.material.invProjectionMatrix.copy( camera.projectionMatrixInverse );
                ptRenderer.material.setDefine( 'MATERIAL_LENGTH', this.ptMaterials.length );
                ptRenderer.material.materials.updateFrom( this.ptMaterials );
                ptRenderer.update();

                fsQuad.material.map = ptRenderer.target;
                fsQuad.render( renderer );

            } else {

                renderer.clear();

            }

        } );

    }

}
