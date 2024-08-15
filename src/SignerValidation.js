import React, { useCallback, useEffect, useState, useRef } from 'react'
import { Button, Col, Row, Space, Spin, Typography } from 'antd'
import axios from 'axios'
import PSPDFKit from 'pspdfkit'

const { Title } = Typography

const SERVER_URL = "http://api.staging-vm.pivott.com"
export default function SignerValidation() {

    const [isVerifying, setIsVerifying] = useState(true)
    const [signer, setSigner] = useState({})
    const [files, setFiles] = useState([])
    const [currentPage] = useState(0)
    const [isLoadingFiles, setIsLoadingFiles] = useState(false)
    const [serverDate, setServerDate] = useState("")
    const [isProcessing] = useState(false)

    // PSPDFKit
    const containerRef = useRef(null);

    useEffect(() => {
        const query = new URLSearchParams(window.location.search)

        const email = query.get("email")
        const token = query.get("url_token")
        if (email && token) {
            signerVerify(email, token)
        }
    }, [])

    const signerVerify = (email, token) => {
        axios.get(`${SERVER_URL}/envelopes/signer-validation`, { params: { email, url_token: token } })
            .then(res => {
                let { data, status } = res
                if (status === 200) {
                    setSigner(data)
                    // console.log('data', data)
                }
            })
            .catch(err => {
                console.log('err', err)
            })
            .finally(() => {
                setIsVerifying(false)
            })
    }

    const getFiles = useCallback(async () => {
        if (signer._id) {

            const { files } = signer
            const s3FileBucket = "pivott-envelopes"
            const prefix = files[0].Key.split("/")
            const routeURL = `${prefix[0]}/${prefix[1]}/${prefix[2]}`

            setIsLoadingFiles(true)
            try {
                const params = { Bucket: s3FileBucket, Prefix: `${routeURL}/` }
                const { data } = await axios.post(`${SERVER_URL}/s3/fetch-public-objects`, params);
                const files = data.Contents;
                const updatedFiles = files.map((file) => {
                    let item = { ...file }
                    let labels = file.Key.split("/")
                    item.label = labels[labels.length - 1]
                    item.id = file.ETag
                    item.url = `https://pivott-envelopes.s3.amazonaws.com/${file.Key}`
                    return item
                })

                setFiles(updatedFiles)

            } catch (error) {
                console.error('Error listing files:', error);
            }
            setIsLoadingFiles(false)
        }
    }, [signer])
    useEffect(() => { getFiles() }, [getFiles])

    const getDateFromServer = useCallback(() => {
        axios.get(`${SERVER_URL}/auth/server-date`)
            .then(res => {
                let { data, status } = res
                if (status === 200) {
                    setServerDate(data.serverDate)
                }
            })
            .catch(err => {
                console.error('err', err)
            })
    }, [])
    useEffect(() => { getDateFromServer() }, [getDateFromServer])

    // Function to get signature form fields
    const getSignatureFormFields = async (instance) => {
        const formFields = await instance.getFormFields();
        return formFields.filter(formField => (
            formField instanceof PSPDFKit.FormFields.SignatureFormField
        ));
    };

    const getWidgetAnnotations = async (instance, pageCount) => {
        const widgetAnnotations = (
            await Promise.all(
                Array.from({ length: pageCount }).map((_, pageIndex) =>
                    instance.getAnnotations(pageIndex)
                        .then(annotations => annotations
                            .filter(annotation => annotation instanceof PSPDFKit.Annotations.WidgetAnnotation))
                )
            )
        )
            .flat()
            .flatMap(annotation => annotation._tail ? annotation._tail.array : []);
        return widgetAnnotations
    };

    // Function to get all signature annotations
    const getSignatures = async (instance, pageCount) => {
        const signatures = (
            await Promise.all(
                Array.from({ length: pageCount }).map((_, pageIndex) =>
                    instance
                        .getAnnotations(pageIndex)
                        .then((annotations) =>
                            annotations.filter(
                                (annotation) => {
                                    return void 0 !== annotation.isSignature
                                    // return annotation instanceof PSPDFKit.Annotations.WidgetAnnotation
                                }
                            )
                        )
                )
            )
        )
            .flat()
            .flatMap(signature => signature._tail ? signature._tail.array : [])

        return signatures
    };

    // Function to update the "Sign Here" widget position
    const updateSignHereWidget = useCallback(async (instance, signHereWidget) => {
        if (instance && signer.signer_type) {
            const currentSigner = signer[signer.signer_type][0]
            let initialFieldName = null
            let signFieldName = null
            if (!signer.isSigner) {
                return
            } else {
                if (signer.signer_type === "buyers" || signer.signer_type === "landlords") {
                    initialFieldName = "buyer_" + signer.signer_index + "_initial_"
                    signFieldName = "buyer_" + signer.signer_index + "_sign_" + 0
                }
                else if (signer.signer_type === "sellers" || signer.signer_type === "tenants") {
                    initialFieldName = "seller_" + signer.signer_index + "_initial_"
                    signFieldName = "seller_" + signer.signer_index + "_sign_" + 0
                }
                else if (signer.signer_type === "buyers_agent" || signer.signer_type === "landlords_agent") {
                    initialFieldName = "buyers_agent_" + signer.signer_index + "_initial_"
                    signFieldName = "buyers_agent_" + signer.signer_index + "_sign_" + 0
                }
                else if (signer.signer_type === "sellers_agent" || signer.signer_type === "tenants_agent") {
                    initialFieldName = "sellers_agent_" + signer.signer_index + "_initial_"
                    signFieldName = "sellers_agent_" + signer.signer_index + "_sign_" + 0
                }
                else {
                    initialFieldName = currentSigner.email
                    signFieldName = currentSigner.email
                }
            }
            const signatureForms = await getSignatureFormFields(instance);
            const widgetAnnotations = await getWidgetAnnotations(instance, instance.totalPageCount);
            const signatureFieldsName = signatureForms.map(field => field.name);
            const signatureWidgets = widgetAnnotations.filter(
                annotation => signatureFieldsName.includes(annotation.formFieldName)
            ).filter(annotation => annotation.formFieldName?.includes(signFieldName) || annotation.formFieldName?.includes(initialFieldName) || annotation.formFieldName?.includes(currentSigner.email))
            const signatures = await getSignatures(instance, instance.totalPageCount);

            let firstWidget = signatureWidgets.find(annotation => {
                return !signatures.some(signature => {
                    let box1 = signature.boundingBox;
                    let box2 = annotation.boundingBox;
                    // instance.contentDocument.scrollTo(annotation.boundingBox.height + annotation.boundingBox.top)
                    return box1.left >= box2.left &&
                        box1.top >= box2.top &&
                        box1.left + box1.width <= box2.left + box2.width &&
                        box1.top + box1.height <= box2.top + box2.height;
                });
            });

            if (firstWidget) {
                const element = instance.contentDocument.querySelector(
                    `.PSPDFKit-Annotation[data-annotation-id="${firstWidget.id}"]`
                );
                // let state = instance.viewState;
                // instance.setViewState(
                //     state.set("currentPageIndex", firstWidget.pageIndex)
                // );

                if (element) {
                    const position = element.getBoundingClientRect();
                    const topPosition = position.top + window.scrollY
                    // signHereWidget.style.top = (topPosition - 10) + "px";
                    // signHereWidget.style.left = `calc(${position.left + window.scrollX}px - 12%)`;
                    signHereWidget.style.top = (topPosition - 15) + "px";
                    signHereWidget.style.left = 0;
                    signHereWidget.style.display = "block";
                } else {
                    // instance.contentDocument.querySelector(".PSPDFKit-Scroll").scrollBy({ top: 20, behavior: 'smooth' });
                    console.error("Element for firstWidget not found");
                }
            } else {
                signHereWidget.style.display = "none";
            }
        }
    }, [signer]);

    function injectCustomStyles(contentDocument) {
        const customStyles = `
            .PSPDFKit-Root > div > div:nth-child(2) {
                position: relative;
                z-index: 100;
            }
            .PSPDFKit-Modal-Backdrop {
                position: fixed !important;
            }
        `;

        const styleElement = document.createElement("style");
        styleElement.type = "text/css";

        if (styleElement.styleSheet) {
            styleElement.styleSheet.cssText = customStyles;
        } else {
            styleElement.appendChild(document.createTextNode(customStyles));
        }

        if (contentDocument.head) {
            contentDocument.head.appendChild(styleElement);
        } else {
            contentDocument.body.appendChild(styleElement);
        }
    }

    useEffect(() => {

        const file = files[currentPage]?.url

        if (file && signer._id) {
            const container = containerRef.current;
            let PSPDFKit;
            (async () => {
                PSPDFKit = await import("pspdfkit");
                PSPDFKit.unload(container)

                const loadObject = {
                    container,
                    document: file,
                    // document: "https://pj-document-bucket.s3.ca-central-1.amazonaws.com/The+Magnificent+Agreement+Regarding+the+History+of+the+Portable+Document+Format.pdf",
                    licenseKey: "",
                    baseUrl: `${window.location.origin}/`,
                    toolbarItems: [...PSPDFKit.defaultToolbarItems, { type: "form-creator" }],
                    // initialViewState: new PSPDFKit.ViewState({
                    //     showToolbar: false,
                    //     // sidebarMode: PSPDFKit.SidebarMode.THUMBNAILS
                    // })
                }

                await PSPDFKit.load(loadObject).then(async (instance) => {

                    // instance.setViewState(viewState => viewState.set("showToolbar", !viewState.showToolbar));

                    const currentSigner = signer[signer.signer_type][0]

                    instance.setIsEditableAnnotation(annotation => false)
                    if (!signer.isSigner) {
                        instance.setIsEditableAnnotation(annotation => false)
                    } else {
                        // instance.setIsEditableAnnotation(annotation => annotation?.formFieldName?.includes(currentSigner.email))
                        if (signer.signer_type === "buyers" || signer.signer_type === "landlords") {
                            const buyerInitialFieldName = "buyer_" + signer.signer_index + "_initial_"
                            const buyerSignFieldName = "buyer_" + signer.signer_index + "_sign_" + 0
                            instance.setIsEditableAnnotation((annotation) => annotation.creatorName === buyerSignFieldName || annotation?.formFieldName?.includes(buyerInitialFieldName) || annotation?.formFieldName?.includes(currentSigner.email))
                        }
                        else if (signer.signer_type === "sellers" || signer.signer_type === "tenants") {
                            const sellerInitialFieldName = "seller_" + signer.signer_index + "_initial_"
                            const sellerSignFieldName = "seller_" + signer.signer_index + "_sign_" + 0
                            instance.setIsEditableAnnotation((annotation) => annotation.creatorName === sellerSignFieldName || annotation?.formFieldName?.includes(sellerInitialFieldName) || annotation?.formFieldName?.includes(currentSigner.email))
                        }
                        else if (signer.signer_type === "buyers_agent" || signer.signer_type === "landlords_agent") {
                            // const buyersAgentSignFieldName = "buyers_agent_" + signer.signer_index + "_sign_"
                            // instance.setIsEditableAnnotation((annotation) => annotation?.formFieldName?.includes(buyersAgentSignFieldName) || annotation?.formFieldName?.includes(currentSigner.email))
                            const buyersAgentInitialFieldName = "buyers_agent_" + signer.signer_index + "_initial_"
                            const buyersAgentSignFieldName = "buyers_agent_" + signer.signer_index + "_sign_" + 0
                            instance.setIsEditableAnnotation((annotation) => annotation?.formFieldName === buyersAgentSignFieldName || annotation?.formFieldName?.includes(buyersAgentInitialFieldName) || annotation?.formFieldName?.includes(currentSigner.email))
                        }
                        else if (signer.signer_type === "sellers_agent" || signer.signer_type === "tenants_agent") {
                            const sellersAgentInitialFieldName = "sellers_agent_" + signer.signer_index + "_initial_"
                            const sellersAgentSignFieldName = "sellers_agent_" + signer.signer_index + "_sign_" + 0
                            instance.setIsEditableAnnotation((annotation) => annotation?.formFieldName === sellersAgentSignFieldName || annotation?.formFieldName?.includes(sellersAgentInitialFieldName) || annotation?.formFieldName?.includes(currentSigner.email))
                            // const sellersAgentSignFieldName = "sellers_agent_" + signer.signer_index + "_sign_"
                            // instance.setIsEditableAnnotation((annotation) => annotation?.formFieldName?.includes(sellersAgentSignFieldName) || annotation?.formFieldName?.includes(currentSigner.email))
                        }
                        else {
                            instance.setIsEditableAnnotation(annotation => annotation?.formFieldName?.includes(currentSigner.email))
                        }
                    }

                    const contentDocument = instance.contentDocument;
                    const signHereWidget = document.createElement("div");
                    signHereWidget.id = "sign-here-widget";
                    signHereWidget.className = "sign-here";
                    signHereWidget.style.position = "absolute";
                    signHereWidget.style.display = "none";
                    signHereWidget.style.zIndex = "1";

                    signHereWidget.innerHTML = `
                     <svg viewBox="193.583 215.541 113.747 40.714" width="113.747" height="40.714">
                      <path d="M 193.709 216.256 H 287.206 L 287.206 216.256 L 307.206 236.256 L 287.206 256.256 L 287.206 256.256 H 193.709 V 216.256 Z"
                            style="fill: rgb(90, 120, 255); stroke: rgb(255, 255, 255);"></path>
                      <text style="fill: rgb(254, 254, 254); font-family: Arial, sans-serif; font-size: 19.1px;" x="201.663" y="242.006">Sign Here</text>
                    </svg>
                     `;

                    contentDocument.body.appendChild(signHereWidget);

                    injectCustomStyles(contentDocument);

                    const scrollHandler = () => { updateSignHereWidget(instance, signHereWidget) }
                    const annotationChangeHandler = () => { updateSignHereWidget(instance, signHereWidget) }

                    contentDocument.querySelector(".PSPDFKit-Scroll").addEventListener("scroll", scrollHandler);
                    instance.addEventListener("annotations.change", annotationChangeHandler);

                    setTimeout(() => { updateSignHereWidget(instance, signHereWidget) }, 1000);
                    // window.setTimeout(updateSignHereWidget, 1e3);

                    // Initials and Signature code started
                    {
                        // Use this for storing signatures within a session
                        let sessionSignatures = [];
                        let sessionInitials = [];
                        let formFieldsClicked = []

                        let lastFormFieldClickedIsInitial = false;
                        // Track which signature form field was clicked on
                        // and wether it was an initial field or not.
                        instance.addEventListener("annotations.press", async (event) => {

                            let lastFormFieldClicked = event.annotation;
                            // console.log('lastFormFieldClicked', lastFormFieldClicked)

                            let annotationsToLoad;
                            if (lastFormFieldClicked.formFieldName && lastFormFieldClicked.formFieldName.includes("initial")) {
                                lastFormFieldClickedIsInitial = true;
                                annotationsToLoad = sessionInitials;

                                if (instance && annotationsToLoad.length > 0) {

                                    event.preventDefault();
                                    if (formFieldsClicked.some(annotation => annotation.id === lastFormFieldClicked.id)) { return }
                                    else { formFieldsClicked.push(lastFormFieldClicked) }


                                    const signatureAnnotation = annotationsToLoad[0];
                                    let x = -(signatureAnnotation.boundingBox.left - lastFormFieldClicked.boundingBox.left) + 10
                                    let y = -(signatureAnnotation.boundingBox.top - lastFormFieldClicked.boundingBox.top) + 1.5
                                    if (signatureAnnotation instanceof PSPDFKit.Annotations.InkAnnotation) {
                                        const newLines = signatureAnnotation.lines.map((line) =>
                                            line.map((point) => {
                                                return new PSPDFKit.Geometry.DrawingPoint({
                                                    x: point.x,
                                                    y: point.y,
                                                }).translate({ x, y })
                                            })
                                        );
                                        let newAnnotation = signatureAnnotation
                                            .set("boundingBox",
                                                signatureAnnotation.boundingBox.translate(
                                                    new PSPDFKit.Geometry.Point({ x, y }) // This needs to be adjusted with the same top x and y
                                                )
                                            )
                                            .set("lines", newLines)
                                            .set("pageIndex", lastFormFieldClicked.pageIndex)
                                            .set("id", window.getRandomId());
                                        instance.create(newAnnotation);
                                    } else if (signatureAnnotation instanceof PSPDFKit.Annotations.ImageAnnotation) {
                                        let newAnnotation = signatureAnnotation
                                            .set("boundingBox",
                                                signatureAnnotation.boundingBox.translate(
                                                    new PSPDFKit.Geometry.Point({ x, y })
                                                )
                                            )
                                            .set("pageIndex", lastFormFieldClicked.pageIndex)
                                            .set("id", window.getRandomId());
                                        instance.create(newAnnotation);
                                    }
                                }

                            } else {
                                lastFormFieldClickedIsInitial = false;
                                annotationsToLoad = sessionSignatures;
                                if (instance && annotationsToLoad.length > 0) {

                                    event.preventDefault();
                                    if (formFieldsClicked.some(annotation => annotation.id === lastFormFieldClicked.id)) { return }
                                    else { formFieldsClicked.push(lastFormFieldClicked) }

                                    const signatureAnnotation = annotationsToLoad[0];
                                    let x = -(signatureAnnotation.boundingBox.left - lastFormFieldClicked.boundingBox.left) + 10
                                    let y = -(signatureAnnotation.boundingBox.top - lastFormFieldClicked.boundingBox.top) + 1.5
                                    if (signatureAnnotation instanceof PSPDFKit.Annotations.InkAnnotation) {
                                        const newLines = signatureAnnotation.lines.map((line) =>
                                            line.map((point) => {
                                                return new PSPDFKit.Geometry.DrawingPoint({
                                                    x: point.x,
                                                    y: point.y,
                                                }).translate({ x, y })
                                            })
                                        );
                                        let newAnnotation = signatureAnnotation
                                            .set("boundingBox",
                                                signatureAnnotation.boundingBox.translate(
                                                    new PSPDFKit.Geometry.Point({ x, y }) // This needs to be adjusted with the same top x and y
                                                )
                                            )
                                            .set("lines", newLines)
                                            .set("pageIndex", lastFormFieldClicked.pageIndex)
                                            .set("id", window.getRandomId());
                                        instance.create(newAnnotation);
                                    } else if (signatureAnnotation instanceof PSPDFKit.Annotations.ImageAnnotation) {
                                        let newAnnotation = signatureAnnotation
                                            .set("boundingBox",
                                                signatureAnnotation.boundingBox.translate(
                                                    new PSPDFKit.Geometry.Point({ x, y })
                                                )
                                            )
                                            .set("pageIndex", lastFormFieldClicked.pageIndex)
                                            .set("id", window.getRandomId());
                                        instance.create(newAnnotation);
                                    }
                                }
                            }

                            instance.setStoredSignatures(PSPDFKit.Immutable.List(annotationsToLoad));

                        });

                        let formDesignMode = !1;

                        let globalCheckbox;

                        instance.setToolbarItems((items) => [...items, { type: "form-creator" }]);
                        instance.addEventListener("viewState.change", (viewState) => {
                            formDesignMode = viewState.formDesignMode === true;
                        });

                        // Select the element that is an ancestor of the modal, could be document.body for simplicity
                        const targetNode = instance.contentDocument;

                        // Options for the observer (which mutations to observe)
                        const config = { attributes: true, childList: true, subtree: true };

                        // Callback function to execute when mutations are observed
                        const callback = function (mutationsList, observer) {

                            for (const mutation of mutationsList) {

                                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                                    mutation.addedNodes.forEach(node => {
                                        if (node.classList && node.classList.contains('PSPDFKit-Form-Creator-Popover')) {
                                            modalOpenedCallback();
                                        }
                                    });
                                }
                                if (mutation.type === 'childList' && mutation.removedNodes.length) {
                                    mutation.removedNodes.forEach(node => {
                                        if (node.classList && node.classList.contains('PSPDFKit-Form-Creator-Popover')) {
                                            modalClosedCallback();
                                        }
                                    });
                                }


                                // Change the title of the signature modal to "Add Initials" if
                                // the signature field is actually an Initials field
                                if (lastFormFieldClickedIsInitial === true) {

                                    mutation.addedNodes.forEach(function (node) {
                                        if (node.nodeType === Node.ELEMENT_NODE) {
                                            var modalElement = node.querySelector(".PSPDFKit-Modal-Dialog");
                                            if (modalElement) {
                                                modalElement.querySelector(".PSPDFKit-Modal-Dialog > p").innerText = "Add Initials";
                                            }
                                        }

                                        // Change the title and buttons for when user selects a pre-saved Initial
                                        if (node.nodeType === Node.ELEMENT_NODE) {
                                            let modalElement = node.querySelector(".PSPDFKit-Electronic-Signatures-Signature-Heading");
                                            if (modalElement) {
                                                modalElement.innerText = "Initials"
                                            }
                                            let buttonElement = node.querySelector(".PSPDFKit-Electronic-Signatures-Add-Signature-Button");
                                            if (buttonElement) {
                                                buttonElement.innerText = "Add Initial"
                                            }
                                        }
                                    });
                                }

                            }
                        };

                        // Create an instance of the observer with the callback function
                        const observer = new MutationObserver(callback);

                        // Start observing the target node for configured mutations
                        observer.observe(targetNode, config);

                        // Later, you can stop observing
                        // observer.disconnect();

                        let formFieldName;
                        async function modalOpenedCallback() {

                            // Track the form field name for later
                            const inputElements = instance.contentDocument.querySelectorAll('input.PSPDFKit-Form-Creator-Editor-Form-Field-Name');
                            formFieldName = inputElements[0].defaultValue;

                            function handleInput(event) {
                                formFieldName = event.target.value;
                            }

                            inputElements[0].addEventListener('input', handleInput);
                            inputElements[0].addEventListener('change', handleInput);

                            // Read the annotation data to check if there is a custom
                            // data property called "isInitial" set
                            let isInitialField = null;
                            const pagesAnnotations = await Promise.all(
                                Array.from({ length: instance.totalPageCount }).map((_, pageIndex) =>
                                    instance.getAnnotations(pageIndex)
                                )
                            );
                            pagesAnnotations.forEach(async pageAnnots => {
                                const annot = pageAnnots.toArray().find(annot => annot.formFieldName === formFieldName);
                                if (annot && annot.customData) {
                                    if (annot.customData.isInitial === true)
                                        isInitialField = true
                                }
                            });

                            // Add the Checkbox to the UI and pass in a flag to
                            // set the checkbox to checked or unchecked.
                            addCheckBoxToUI(isInitialField);

                        }

                        async function modalClosedCallback() {

                            let isInitial = false;

                            const pagesAnnotations = await Promise.all(
                                Array.from({ length: instance.totalPageCount }).map((_, pageIndex) =>
                                    instance.getAnnotations(pageIndex)
                                )
                            );

                            if (globalCheckbox && globalCheckbox.checked) {
                                isInitial = true;
                            } else {
                                isInitial = false;
                            }

                            let updatedAnnotation;
                            pagesAnnotations.forEach(async pageAnnots => {
                                const annot = pageAnnots.toArray().find(annot => annot.formFieldName === formFieldName);
                                if (annot) {
                                    updatedAnnotation = await annot.set("customData", {
                                        isInitial: isInitial
                                    });
                                    console.log(annot);
                                    let updatedAnnot = await instance.update(updatedAnnotation);
                                    console.log(updatedAnnot);
                                }
                            });
                        }

                        function addCheckBoxToUI(isInitialField) {
                            if (formDesignMode) {
                                let formModal = instance.contentDocument.getElementsByClassName("PSPDFKit-Form-Creator-Editor")[0].childNodes[0].childNodes[1];

                                // Create a div to wrap the checkbox and label
                                let wrapperDiv = instance.contentDocument.createElement("div");
                                wrapperDiv.classList.add("checkbox-wrapper"); // Optional: Add a class for styling
                                wrapperDiv.style.display = 'flex'; // This enables Flexbox for the wrapper div
                                wrapperDiv.style.alignItems = 'center'; // This vertically centers the items in the div
                                wrapperDiv.style.justifyContent = 'flex-start';

                                // Create a checkbox element
                                let checkbox = instance.contentDocument.createElement("input");
                                checkbox.setAttribute("type", "checkbox");
                                checkbox.setAttribute("id", "initialsFieldCheckbox");
                                checkbox.setAttribute("name", "initialsField");
                                checkbox.setAttribute("value", "Initials");
                                checkbox.style.transform = "scale(1.3)"; // Adjust the scale value as needed
                                checkbox.style.marginLeft = "9px"; // Adds some space between the checkbox and the label
                                checkbox.style.marginRight = "7px";
                                checkbox.checked = isInitialField;
                                //checkbox.checked = true;
                                globalCheckbox = checkbox;

                                // Create a label for the checkbox
                                let label = instance.contentDocument.createElement("label");
                                label.setAttribute("for", "initialsFieldCheckbox");
                                label.innerText = "Initials Field";
                                label.style.fontSize = "15px"; // Adjust the font size as needed
                                label.style.paddingBottom = "1px";


                                // Append the checkbox and label to the wrapper div
                                wrapperDiv.appendChild(checkbox);
                                wrapperDiv.appendChild(label);

                                // Append the wrapper div to the form modal
                                formModal.appendChild(wrapperDiv);

                                // Copy styles from a sibling button, if needed
                                let siblingButton = instance.contentDocument.querySelector('.PSPDFKit-Expando-Control').children[0];
                                if (siblingButton) {
                                    let computedStyle = window.getComputedStyle(siblingButton);
                                    // Example of copying selected properties, adjust as needed
                                    let propertiesToCopy = ['font-family', 'font-size', 'color', 'margin', 'padding', 'background-color'];
                                    propertiesToCopy.forEach(property => {
                                        wrapperDiv.style[property] = computedStyle[property];
                                    });
                                }
                            }
                        }

                        // let isSignatureNew = false;
                        instance.addEventListener('annotations.create', async (createdAnnotations) => {
                            // Determine the correct storage key based on whether it's an initial
                            //const storageKey = lastFormFieldClickedIsInitial ? INITIALS_STORAGE_KEY : SIGNATURES_STORAGE_KEY;
                            let annotation = createdAnnotations._tail.array[0];

                            // console.log("annotation to be saved");
                            // console.log(annotation);

                            // Logic for showing signatures and intials in the UI
                            //const annotation = createdAnnotations.toArray()[0];

                            //if (annotation instanceof PSPDFKit.Annotations.InkAnnotation) {
                            const isInitial = lastFormFieldClickedIsInitial;
                            //const serializedAnnotation = PSPDFKit.Annotations.toSerializableObject(annotation);

                            if (isInitial) {
                                sessionInitials.length < 1 && sessionInitials.push(annotation); formFieldsClicked.push(lastFormFieldClicked);
                            } else {
                                sessionSignatures.length < 1 && sessionSignatures.push(annotation); formFieldsClicked.push(lastFormFieldClicked);
                            }
                            // console.log(sessionInitials);
                            // console.log(sessionSignatures);

                        });
                    }
                    // Initials and Signature code ended

                    let lastFormFieldClicked;
                    instance.addEventListener("annotations.press", (event) => { lastFormFieldClicked = event.annotation });
                    instance.addEventListener("annotations.create", (createdAnnotations) => {
                        (async (createdAnnotations) => {
                            let createdAnnotationsFlat = createdAnnotations.toArray()[0];
                            if (createdAnnotationsFlat.isSignature && lastFormFieldClicked) {
                                const formFieldName = lastFormFieldClicked.formFieldName
                                const dateField = formFieldName + "_date"

                                const formFields = instance.getFormFieldValues();
                                for (const key of Object.keys(formFields)) {
                                    if (key === dateField) {
                                        instance.setFormFieldValues({ [key]: `Pivott Verified: ${serverDate}` });
                                    }
                                }
                                lastFormFieldClicked = null;
                            }
                        })(createdAnnotations);
                    });

                    // const formFieldValues = instance.getFormFieldValues();
                    // console.log(formFieldValues);

                    // Removing background color. Setting to transparent
                    const refreshWidgets = async () => {
                        // Retrieve all form fields.
                        const formFields = await instance.getFormFields();

                        // Retrieve all widget annotations in the document.
                        const widgetAnnotations = (
                            await Promise.all(
                                Array.from({ length: instance.totalPageCount }).map(async (_, pageIndex) =>
                                    (await instance.getAnnotations(pageIndex)).filter((it) => it instanceof PSPDFKit.Annotations.WidgetAnnotation)
                                )
                            )
                        ).flatMap((pageAnnotations) => pageAnnotations.toArray()); // Flatten the array of arrays

                        // Iterate over all form fields and their widgets to update their appearance.
                        const widgetsToUpdate = formFields.flatMap((formField) => {
                            // Find all widget annotations for a given form field.
                            const widgets = widgetAnnotations.filter((annotation) => formField.annotationIds.contains(annotation.id) || formField.annotationIds.contains(String(annotation.pdfObjectId)))
                            // Update all widgets
                            return widgets.map((widget) => {
                                // console.log('widget', widget)
                                return widget.set("backgroundColor", PSPDFKit.Color.TRANSPARENT).set('borderColor', PSPDFKit.Color.TRANSPARENT).set('borderWidth', undefined).set('borderStyle', undefined)
                            });
                        })
                        // Now perform the batch update with our updated widget annotations.
                        return instance.update(widgetsToUpdate);
                    }

                    refreshWidgets()
                    return () => {
                        contentDocument.querySelector(".PSPDFKit-Scroll").removeEventListener("scroll", scrollHandler);
                        instance.removeEventListener("annotations.change", annotationChangeHandler);
                    };
                }).catch(error => {
                    console.error(error.message);
                });
            })();

            // return () => PSPDFKit && PSPDFKit.unload(container);
        }
    }, [files, currentPage, signer, serverDate, updateSignHereWidget]);

    if (isVerifying)
        return <main className='flex-center'><Spin size='large' /></main>
    if (!signer._id)
        return <main className='flex-center'><Title level={5} className='text-blue mb-0'>Access Denied</Title></main>

    return (
        <>
            <main>
                <div style={{ padding: 24 }}>
                    <Row gutter={[16]}>
                        <Col span={24}>
                            <div style={{ maxWidth: 1000, border: "1px solid #DED2F980", height: "calc(100vh - 48px)", margin: "0 auto" }}>
                                {!isLoadingFiles
                                    ? <>{files[currentPage]?.url && <div ref={containerRef} style={{ height: "100%" }} />}</>
                                    : <div className='h-100 flex-center'><Spin size='large' /></div>
                                }
                            </div>
                        </Col>
                    </Row>
                </div>
            </main>
        </>
    )
}
