import React from 'react';
import {compose, withState, withHandlers, withProps, lifecycle} from 'recompose';
import RoundedButton from 'components/RoundedButton';
import PageTitle from 'components/PageTitle';
import theme from 'theme';
import Logos from 'components/Logos';
import Modal from 'components/Modal';
import RegistrationForm from 'components/RegistrationForm';
import {withIO} from 'react-io';
import ErrorModal from 'components/ErrorModal';
import Background from 'components/Background';
import LocaleString from 'components/LocaleString';
import LoadingScreen from 'components/LoadingScreen';
import {modals, WIZARD_STATE, getEmployersNeedingOnboarding, ANALYTICS_EVENTS} from 'common/utils';
import {keys, has, isEmpty, isNil, mapValues, pickBy, intersection, isEqual, filter, uniq, map, values} from 'lodash';
import {createSchema, columnsForWizardState} from 'schema/registrationSchema';
import {validate, transformErrors} from 'schema/validate';
import moment from 'moment';
import EarlyBirdPage from "./components/EarlyBirdPage";
import ModalCloseDialog from "./components/ModalCloseDialog";
import SupportFooter from "./components/SupportFooter";
import LocaleSwitch from 'components/LocaleSwitch'
import Fader from 'components/Fader'
import {checkCookie} from "./session/source";


const {
  layout: {margin},
  palette: {white},
} = theme;


export default compose(
  withIO({
    config: '/config',
    smallScreen: '/client/smallScreen',
    appUrl: '/account/appUrl',
    ssoInitUrl: '/account/ssoInitUrl',
    session: '/session',
  }),
  withState('error', 'setError', undefined),
  withState('modalOpen', 'setModalOpen', ({error,}) =>
    error ? modals.ERROR : null,
  ),
  withState('primalDemographics', 'setPrimalDemographics', {}),
  withState('inBound', 'setInBound', null),
  withState('ssoAccountInfo', 'setSsoAccountInfo', {}),
  withState('currentWizardState', 'setCurrentWizardState', -1),
  withState('columns', 'setColumns', []),
  withState('cameThroughLogin', 'setCameThroughLogin', false),
  withState('loading', 'setLoading', false),
  withState('emailOptIn', 'setEmailOptIn', true),
  withState('confirmModalCloseDialog', 'setConfirmModalCloseDialog', false),
  withState('earlyBirdFlag', 'setEarlyBirdFlag', false),
  withProps(
    ({config}) => ({
      schema: createSchema({config}),
    }),
  ),
  withProps(({schema}) => ({
      columnsForWizardState: columnsForWizardState(schema)
  })),
  withHandlers({
      filterColumns: ({config: {columns, idConfig: {field: eligibilityField}}, session, primalDemographics}) => () =>
          session?
              isEmpty(primalDemographics) ? columns : columns.filter(({fieldName}) => fieldName !== eligibilityField)
              : columns,
      checkEmailExists: ({io}) => async (email) => {
        if(!email)
            return Promise.resolve(false);

        let result = await io('/remote/api/emailExists', 'POST', {data: {email: email}})
            .then(res => Promise.resolve(res.result))
            .catch(ex => Promise.reject(ex));

        return result;
        },
  }),
  withHandlers({
      calculateFormData: ({filterColumns, schema: {required, properties}, primalDemographics, ssoAccountInfo, setColumns}) => () => {
          let columns = filterColumns();
          setColumns(columns);

          let objToUse = isEmpty(primalDemographics) ? (isEmpty(ssoAccountInfo) ? {} : ssoAccountInfo) : primalDemographics;
          return (
              columns.reduce(
                  (acc, {fieldName, value}) => {
                      const defaultValue = objToUse[fieldName] || value || properties[fieldName].value || null;
                      const isRequired = required.includes(fieldName);
                      const {errors} = validate(defaultValue, properties[fieldName], {
                        checkRequired: isRequired,
                      });
                      return {
                          ...acc,
                          [fieldName]: {
                              value: defaultValue,
                              inputProps: {readOnly: (!isEmpty(primalDemographics) &&
                                  !isNil(objToUse[fieldName]) &&
                                  objToUse[fieldName] !== '' &&
                                  fieldName !== 'email' ? true : false)},
                              label: properties[fieldName].label,
                              error: Boolean(errors.length),
                              helperText: transformErrors(errors),
                              required: isRequired,
                          },
                      }
                  }, {})
          );
      }
  }),
  withState('formData', 'setFormData', ({calculateFormData}) => calculateFormData()),
  withHandlers({
      setDefaultEmailOptIn: ({io, setEmailOptIn, formData}) => async () => {
          let country = 'United States';
          if (has(formData, 'country'))
              country = formData.country.value;

          let zipCode = null;
          if (has(formData, 'postalCode'))
              zipCode = formData.postalCode.value;

          if (isNil(zipCode) ||
              isNil(country) ||
              zipCode.length !== 5 ||
              country.toUpperCase() !== 'UNITED STATES')
          {
              setEmailOptIn(true);
              return Promise.resolve(true);
          }
          let result = await io('/remote/api/lookupZipcode', 'GET', {params: {zipcode: zipCode}})
              .then((result) => {
                  if (result.length === 0) {
                      setEmailOptIn(true);
                      return Promise.resolve(true);
                  }
                  else {
                      let emailOptInState = result.find(({state_code}) => state_code.toUpperCase() === 'CA') ? false: true;
                      setEmailOptIn(emailOptInState);
                      return Promise.resolve(emailOptInState);
                  }
              }).catch(ex => Promise.reject(ex));

          return result;
      },
  }),
  withHandlers({
      redirectToApp: ({appUrl, ssoInitUrl}) => () => {
          window.location.href = ssoInitUrl;
      },
      checkEmailExistsOfPrimaryDemographics: ({primalDemographics, ssoAccountInfo, setPrimalDemographics, checkEmailExists, formData, setFormData}) => async () => {
          let primalDemographicEmailFound = null;
          let ssoEmailFound = null;
          if(!isNil(ssoAccountInfo.email) && ssoAccountInfo.email !== ''){
              ssoEmailFound = ssoAccountInfo.email;
          }

          // Loop through all emails found in primal demographics and check if email exists.
          if ((!isNil(primalDemographics.emails) && primalDemographics.emails.length > 0) || (!isNil(primalDemographics.email) && primalDemographics.email !== '')) {
              const emailField = primalDemographics.email;
              if(!isNil(emailField) && emailField !== ''){
                  let result = await checkEmailExists(emailField);
                  if (result) {
                      primalDemographicEmailFound = emailField;
                  }
              }

              if(!primalDemographicEmailFound && !isNil(primalDemographics.emails) && primalDemographics.emails.length > 0) {
                  for (const {email: emailInPrimalDemo} of primalDemographics.emails) {
                      if (!isNil(emailInPrimalDemo) && emailInPrimalDemo !== '' && emailInPrimalDemo !== emailField) {
                          let result = await checkEmailExists(emailInPrimalDemo);
                          if (result) {
                              primalDemographicEmailFound = emailInPrimalDemo;
                              break;
                          }
                      }
                  }
              }
          }

          let foundEmail = primalDemographicEmailFound || ssoEmailFound;
          if(foundEmail){
              formData.email.value = foundEmail;
              formData.email.error = false;
              formData.email.helperText = '';
              setFormData(formData);
              return Promise.resolve(true);
          }
          else{
              return Promise.resolve(false);
          }
      },
  }),
  withHandlers({
    updateSharecareAccount: ({io, formData}) => async (fields) => {
        // Lets prepare data to be passed to server

        const requiredFields = intersection(fields, keys(formData));
        const requiredFieldsFormData = pickBy(formData, (columnData, fieldName) => requiredFields.indexOf(fieldName) !== -1 && !columnData.error && !isNil(columnData.value) && columnData.value != '');

        // Comment below if required to test Demographic without updation of sharecare account
        // if(!isEqual(requiredFields, keys(requiredFieldsFormData)))
        //     return Promise.resolve(false);

        let tempObj = mapValues(requiredFieldsFormData, (columnData, fieldName) => {
            let value = columnData.value;
            switch(fieldName){
                case 'gender':
                    value = value.toUpperCase();
                    break;
                case 'dateOfBirth':
                    value = moment.utc(moment.utc(value, ['YYYY/MM/DD', 'MM/DD/YYYY']).format('MM/DD/YYYY')).valueOf();
            }
            return value;
        });

        let result = await io('/account', 'POST', {data: tempObj})
            .then(() => Promise.resolve(true))
            .catch(ex => Promise.reject(ex));

        return result;
    },
    getAccount: ({io, setSsoAccountInfo, setPrimalDemographics}) => async () => {
        let result = await io('/account')
            .then((res) => {
                setSsoAccountInfo(res);
                setPrimalDemographics({});
                return Promise.resolve(res);
            })
            .catch(ex => Promise.reject(ex));

        return result;
    },
    getPrimalDemographics: ({io, setPrimalDemographics}) => async () => {
        let result = await io('/account/primalDemographics')
            .then((res) => {
                setPrimalDemographics(res);
                return Promise.resolve(res);
            })
            .catch(ex => Promise.reject(ex));

        return result;
    },
    getMemberStatus: ({io, redirectToApp}) => async () => {
        let _cb = moment.utc().unix().toString();
        let result = await io(`/remote/api/getMemberStatus?_cb=${_cb}`)
            .then(res => {
                const status = res.status;
                const consents = res.consents;
                switch(status){
                    case 'NOT_MATCHED':
                    case 'INELIGIBLE':
                        // In both these case show screen for Create Account + membership screen
                        return Promise.reject('NOT_MATCHED_OR_INELIGIBLE');
                    case 'NOT_ENROLLED':
                        return Promise.resolve({'NEVER_ENROLLED': res});
                    case 'ELIGIBLE':
                        if(isNil(consents) || consents.length === 0){
                            redirectToApp();
                            return Promise.reject();
                        }

                        let requiredConsents = consents.filter(consent => consent.required);
                        let notRequiredConsents = consents.filter(consent => !consent.required);
                        let notRequiredConsentsSubmitted  = consents.filter(consent => !consent.required && !isNil(consent.actionDt));

                        if((isNil(requiredConsents) || requiredConsents.length === 0) && !isNil(notRequiredConsents) && notRequiredConsents.length > 0 && (isNil(notRequiredConsentsSubmitted) || notRequiredConsentsSubmitted.length === 0)){
                            // Proceed with normal flow
                            // We need to enroll at-least 1st time.
                            return Promise.resolve({'NEVER_ENROLLED': res});
                        }
                        redirectToApp();
                        return Promise.reject();
                    case 'NOT_CONSENTED':
                        let consentActioned = consents.filter(consent => !isNil(consent.actionDt));
                        return Promise.resolve({[!isNil(consentActioned) && consentActioned.length > 0 ? 'ALREADY_ENROLLED_ONCE': 'NEVER_ENROLLED']: res});
                }
            })
            .catch(ex=> Promise.reject(ex));

        return result;
    },
    setWizardStateAndOpenRegistration: ({io, setModalOpen, setCurrentWizardState, setLoading}) => (currentWizardState) => {
        io('/error', 'CLEAR');
        setLoading(false);
        setCurrentWizardState(currentWizardState);
        setModalOpen(modals.REGISTRATION);
    },
    closeModal: ({io, setModalOpen, setCurrentWizardState}) => () => {
        io('/error', 'CLEAR');
        // io('/account', 'CLEAR');
        // io('/account/primalDemographics', 'CLEAR');
        setModalOpen(null);
        setCurrentWizardState(-1);
    },
  }),
  withHandlers({
      resetSessionAndOtherData: ({
          io,
          setInBound,
          setSsoAccountInfo,
          setPrimalDemographics,
          setCameThroughLogin,
          setFormData,
          calculateFormData,
          setWizardStateAndOpenRegistration
      }) => (makeAnalyticsCall=false, openCreateAccountWithMembership = false, event) => {
          io('/session', 'CLEAR')
              .then(() => checkCookie())
              .then(() => {
                  // io('/account', 'CLEAR');
                  // io('/account/primalDemographics', 'CLEAR');
                  setInBound(null);
                  setSsoAccountInfo({});
                  setPrimalDemographics({});
                  setCameThroughLogin(false);
              })
              .then(() => setFormData(calculateFormData()))
              .then(() => {
                  if(event){
                      if(makeAnalyticsCall)
                        setTimeout(() => io('/analytics', 'POST', {event: ANALYTICS_EVENTS.CLICK_REGISTRATION_MODAL}), 15000);

                      if(openCreateAccountWithMembership)
                        setWizardStateAndOpenRegistration(WIZARD_STATE.CREATE_ACCOUNT_WITH_MEMBERSHIP);
                      return;
                  }

                  if(makeAnalyticsCall)
                    setTimeout(() => io('/analytics', 'POST', {event: ANALYTICS_EVENTS.LAND_DIRECT}), 15000);
              });
      },
  }),
  withHandlers({
      openSignInModal: ({io, setWizardStateAndOpenRegistration}) => () => {
        io('/analytics', 'POST', {event: ANALYTICS_EVENTS.OPEN_LOGIN_MODAL});
        setWizardStateAndOpenRegistration(WIZARD_STATE.SIGN_IN);
      },
      openSignUpModal: ({columns, config: {idConfig: {field: eligibilityField}}, setWizardStateAndOpenRegistration}) => (event) => {
          if(columns.filter(({fieldName}) => fieldName === eligibilityField).length > 0){
              setWizardStateAndOpenRegistration(WIZARD_STATE.CREATE_ACCOUNT_WITH_MEMBERSHIP);
          }
          else{
              setWizardStateAndOpenRegistration(WIZARD_STATE.CREATE_ACCOUNT);
          }
      },
      loginHandler: (
          {setLoading,
              io,
              session,
              setCurrentWizardState,
              setError,
              getAccount,
              getPrimalDemographics,
              calculateFormData,
              checkEmailExistsOfPrimaryDemographics,
              updateSharecareAccount,
              setModalOpen,
              setFormData,
              formData,
              setWizardStateAndOpenRegistration,
              setDefaultEmailOptIn,
              columnsForWizardState,
              setSsoAccountInfo,
              setPrimalDemographics,
              setInBound,
              getMemberStatus,
              setCameThroughLogin,
              resetSessionAndOtherData
          }) => async (event) => {

          io('/error', 'CLEAR');

          if (!session) {
              resetSessionAndOtherData(true, true, event);
              return;
          }

          setLoading(true);

          let inBoundState = null;
          io('/session/inboundSSO')
              .then(res => {
                  setInBound(res);
                  inBoundState = res;
                  return Promise.resolve(true);
              })
              .then(() => setTimeout(() => io('/analytics', 'POST', {event: ANALYTICS_EVENTS.LAND_SSO}), 15000))
              .then(getAccount)
              .then(async (ssoAccountInfo) => {
                  let result = await Promise.resolve()
                      .then(() => setFormData(calculateFormData()))
                      .then(setDefaultEmailOptIn);

                  return result;
              })
              .then(getMemberStatus)
              .then(res => {
                  let consents = values(res)[0].consents;
                  if(isNil(consents) || consents.length == 0)
                      return Promise.resolve(res);

                  let consent_types = uniq(map(consents, 'type'));
                  if (consent_types.indexOf('HIPAA') > -1 && consent_types.indexOf('CLIENT_HIPAA') > -1)
                      return Promise.reject({response: {status: 513}});
                  else
                      return Promise.resolve(res);
              })
              .then(res => 'ALREADY_ENROLLED_ONCE' in res? Promise.reject('ALREADY_ENROLLED_ONCE'): Promise.resolve(res))
              .then(getPrimalDemographics)
              .then(async (primalDemographics) => {
                  let result = await Promise.resolve()
                      .then(() => setFormData(calculateFormData()))
                      .then(setDefaultEmailOptIn);

                  return result;
              })
              .then(() => {
                  setWizardStateAndOpenRegistration(WIZARD_STATE.CREATE_ACCOUNT);
              })
              .catch(ex => {
                  if(!ex){
                      // Redirection happened in this case and so reject was give but its an empty reject.
                      // Don't do anything here
                      return;
                  }

                  setLoading(false);

                  if (typeof ex === 'string') {
                      if (['NOT_MATCHED_OR_INELIGIBLE', 'ALREADY_ENROLLED_ONCE'].indexOf(ex) !== -1) {
                         // if(!inBoundState){
                         //     if(event)
                         //         setWizardStateAndOpenRegistration(WIZARD_STATE.CREATE_ACCOUNT_WITH_MEMBERSHIP);
                         //     return;
                         // }

                         switch (ex) {
                             case 'NOT_MATCHED_OR_INELIGIBLE':
                                 resetSessionAndOtherData(false, true, event);
                                 break;
                             case 'ALREADY_ENROLLED_ONCE':
                                 setWizardStateAndOpenRegistration(WIZARD_STATE.PREFERENCES);
                                 break;
                         }
                         return;
                      }

                      // Just setting random error status
                        // Just not set 401
                      ex = {response: {status: 512}};
                  }
                  setLoading(false);
                  setError(ex);
                  setModalOpen(modals.ERROR);
              });
      }
  }),
  lifecycle({
      componentDidMount(){
          this.props.loginHandler();
      }
  })
)(function LandingScreen({
  smallScreen,
  modalOpen,
  loading,
  formData,
  openSignUpModal,
  openSignInModal,
  error,
  closeModal,
  session,
  redirectToApp,
  setCurrentWizardState,
  setFormData,
  columns,
  primalDemographics,
  setPrimalDemographics,
  ssoAccountInfo,
  setSsoAccountInfo,
  updateSharecareAccount,
  emailOptIn,
  setEmailOptIn,
  setDefaultEmailOptIn,
  currentWizardState,
  getPrimalDemographics,
  checkEmailExists,
  setError,
  setModalOpen,
  confirmModalCloseDialog,
  setConfirmModalCloseDialog,
  getAccount,
  inBound,
  calculateFormData,
  loginHandler,
  getMemberStatus,
  checkEmailExistsOfPrimaryDemographics,
  cameThroughLogin,
  setCameThroughLogin,
  earlyBirdFlag,
  setEarlyBirdFlag,
  config: {
      makeSignInButtonPrimary = false,
      hideSignUpOnNotInbound = false
  }
}) {
    return (
      <div
        style={{
          color: white,
          minHeight: '100vh',
          display: 'flex',
          flexFlow: 'column nowrap',
          justifyContent: 'space-evenly',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {loading && <LoadingScreen />}
        {confirmModalCloseDialog && <ModalCloseDialog setConfirmModalCloseDialog={setConfirmModalCloseDialog} onRequestClose={closeModal} formData={formData}/>}
        {earlyBirdFlag &&
            (
                <EarlyBirdPage
                    // date={""}
                    // year={""}
                    setEarlyBirdFlag={setEarlyBirdFlag}
                />
            )
        }
        <Background />
        <Logos>
          <Fader
            in={!modalOpen}
            style={{
              display: 'flex',
              margin: 'auto 0 auto auto',
              marginTop: smallScreen ? margin : 'auto',
              textDecoration: "underline"
            }}
          >
            <LocaleSwitch />
          </Fader>
        </Logos>
        <div
          style={{
            flex: '1 0 auto',
            display: 'flex',
            flexFlow: 'column nowrap',
            justifyContent: 'center',
            alignItems: 'center',
            margin,
          }}
        >
          <PageTitle gutter>
            <LocaleString phrase="landing_page_title" html={true} />
          </PageTitle>
          <LocaleString
            phrase="landing_page_content"
            html={true}
            style={{textAlign: 'center', maxWidth: 520}}
          />
        </div>
        {((makeSignInButtonPrimary && !session) || (!makeSignInButtonPrimary && (session || (!session && !hideSignUpOnNotInbound)))) && (
        <RoundedButton style={{margin: 'auto'}} onClick={makeSignInButtonPrimary ? openSignInModal: loginHandler}>
          <LocaleString phrase={makeSignInButtonPrimary ? "sign_in_button" : "sign_up_button"} />
        </RoundedButton>
        )}
        {((makeSignInButtonPrimary && (session || (!session && !hideSignUpOnNotInbound))) || (!makeSignInButtonPrimary && !session)) && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                cursor: 'pointer',
                marginTop: margin,
                fontSize: '14px',
                textAlign: 'center',
              }}
            >
              <span style={{display: 'inline-block', marginBottom: 10}}>
                <LocaleString phrase={makeSignInButtonPrimary ? "sign_up_question" : "sign_in_question"} />
              </span>
              <span
                onClick={makeSignInButtonPrimary ? loginHandler : openSignInModal}
                style={{
                  border: `1px solid ${white}`,
                  borderRadius: 100,
                  padding: '5px 20px',
                  marginLeft: 10,
                  whiteSpace: 'nowrap'
                }}
              >
                <LocaleString phrase={makeSignInButtonPrimary ? "sign_up_button": "sign_in_button"} />
              </span>
            </div>
          </div>
        )}
        <SupportFooter/>
        <Modal
          open={modalOpen}
          style={{
            maxWidth: 552,
            width: '100%'
          }}
        >
          {modalOpen === modals.REGISTRATION ? (
            <RegistrationForm
                inBound={inBound}
                loginHandler={loginHandler}
                setConfirmModalCloseDialog={setConfirmModalCloseDialog}
                onRequestClose={closeModal}
                currentWizardState={currentWizardState}
                openSignInModal={openSignInModal}
                setFormData={setFormData}
                formData={formData}
                setCurrentWizardState={setCurrentWizardState}
                columns={columns}
                primalDemographics={primalDemographics}
                ssoAccountInfo={ssoAccountInfo}
                setPrimalDemographics={setPrimalDemographics}
                setSsoAccountInfo={setSsoAccountInfo}
                updateSharecareAccount={updateSharecareAccount}
                emailOptIn={emailOptIn}
                setEmailOptIn={setEmailOptIn}
                setDefaultEmailOptIn={setDefaultEmailOptIn}
                redirectToApp={redirectToApp}
                getPrimalDemographics={getPrimalDemographics}
                checkEmailExists={checkEmailExists}
                setError={setError}
                setModalOpen={setModalOpen}
                getMemberStatus={getMemberStatus}
                getAccount={getAccount}
                calculateFormData={calculateFormData}
                openSignUpModal={openSignUpModal}
                cameThroughLogin={cameThroughLogin}
                setCameThroughLogin={setCameThroughLogin}
                checkEmailExistsOfPrimaryDemographics={checkEmailExistsOfPrimaryDemographics}
            />
          ) : (
            <ErrorModal onRequestClose={closeModal} error={error} />
          )}
        </Modal>
      </div>
    )
});
